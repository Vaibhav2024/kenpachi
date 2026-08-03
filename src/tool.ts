// src/tool.ts
import { z } from "zod";
import { zodToJsonSchema as zodToJsonSchemaLib } from "zod-to-json-schema";
import type { ToolSchema } from "./types.js";

export interface ToolContext {
    /** Per-run key/value bag — use it to pass user IDs, request IDs, etc. */
    metadata: Record<string, unknown>
    /** Register an undo action for saga rollback (see runner.ts). */
    registerCompensation: (undo: () => Promise<void>) => void
    /**
     * The calling Agent's context, for tools that need to read (never mutate)
     * the parent conversation — used by handoff.ts for context preservation.
     * Populated by runner.ts; undefined if a tool is invoked outside an Agent.
     */
    parentContext?: import("./context.js").AgentContext
}

export interface Tool<Args = any, Result = any> {
    name: string;
    description: string;
    schema: z.ZodTypeAny;
    execute: (args: Args, ctx: ToolContext) => Promise<Result>;
    /** Marks this tool as safe to auto-retry with corrected args (default true). */
    repairable?: boolean
}

/**
 * Define a tool. Using a plain function (not arrow-assigned-to-object) keeps
 * generic inference working when you store tools with different Args types
 * in a single array — see the note in the README about tool array variance.
 */

export function defineTool<Args, Result>(def: {
    name: string;
    description: string;
    schema: any;
    execute(args: Args, ctx: ToolContext): Promise<Result>;
    repairable?: boolean;
}): Tool<Args, Result> {
    return {
        name: def.name,
        description: def.description,
        schema: def.schema,
        execute: def.execute,
        repairable: def.repairable ?? true
    }
}

/**
 * Universal Zod schema serializer converting ZodType into standard JSON Schema object.
 * Strips non-standard outer fields like $schema.
 */
export function serializeZodSchema(schema: any): Record<string, unknown> {
    if (!schema) {
        return { type: "object", properties: {}, required: [] };
    }

    // 0. If schema is already a raw JSON schema object (no Zod _def property)
    if (typeof schema === "object" && !schema._def && (schema.properties || schema.type)) {
        const clean: Record<string, unknown> = { ...schema };
        delete clean.$schema;
        delete clean.definitions;
        return clean;
    }

    // 1. Primary Strategy: Try zod-to-json-schema first (cleanest output for Anthropic & OpenAI)
    try {
        const raw = zodToJsonSchemaLib(schema, {
            $refStrategy: "none",
            target: "jsonSchema7",
        }) as any;

        if (raw && typeof raw === "object") {
            delete raw.$schema;
            delete raw.definitions;

            const properties =
                raw.properties ||
                raw.definitions?.root?.properties ||
                (raw.definitions && (Object.values(raw.definitions)[0] as any)?.properties);

            if (properties) {
                const required =
                    raw.required ||
                    raw.definitions?.root?.required ||
                    (raw.definitions && (Object.values(raw.definitions)[0] as any)?.required) ||
                    [];

                return {
                    type: "object",
                    properties,
                    ...(Array.isArray(required) && required.length > 0 ? { required } : {}),
                };
            }
        }
    } catch (err) {
        // Fall back to shape inspection if library fails
    }

    // 2. Secondary Strategy: Direct Zod Shape Inspection with dynamic types
    let targetSchema = schema;
    while (targetSchema && targetSchema._def) {
        const typeName = targetSchema._def.typeName;
        if (targetSchema.shape || targetSchema._def.shape) break;
        if (typeName === "ZodOptional" || typeName === "ZodNullable" || typeName === "ZodDefault" || typeName === "ZodCatch" || typeName === "ZodReadonly") {
            targetSchema = targetSchema._def.innerType;
        } else if (typeName === "ZodEffects") {
            targetSchema = targetSchema._def.schema;
        } else if (typeName === "ZodPipeline") {
            targetSchema = targetSchema._def.out || targetSchema._def.in;
        } else {
            break;
        }
    }

    const shape = targetSchema?.shape || (typeof targetSchema?._def?.shape === "function" ? targetSchema._def.shape() : targetSchema?._def?.shape);
    if (shape && typeof shape === "object") {
        const properties: Record<string, any> = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(shape)) {
            const valAny = value as any;
            
            // Check if property is optional
            let isOptional = false;
            let currentVal = valAny;
            while (currentVal && currentVal._def) {
                const tName = currentVal._def.typeName;
                if (tName === "ZodOptional") {
                    isOptional = true;
                    break;
                }
                if (tName === "ZodDefault" || tName === "ZodNullable" || tName === "ZodReadonly" || tName === "ZodCatch") {
                    currentVal = currentVal._def.innerType;
                } else if (tName === "ZodEffects") {
                    currentVal = currentVal._def.schema;
                } else {
                    break;
                }
            }

            properties[key] = {
                type: getJsonSchemaType(valAny),
                description: valAny?.description || valAny?._def?.description || key,
            };

            if (!isOptional) {
                required.push(key);
            }
        }

        return {
            type: "object",
            properties,
            ...(required.length > 0 ? { required } : {}),
        };
    }

    return { type: "object", properties: {}, required: [] };
}

/** Convert a Zod schema to a standard JSON schema object for LLM providers. */
export function zodToJsonSchema(schema: z.ZodType<any>): Record<string, unknown> {
    return serializeZodSchema(schema);
}

export function toToolSchema(tool: Tool): ToolSchema {
    return {
        name: tool.name,
        description: tool.description,
        parameters: serializeZodSchema(tool.schema),
    };
}

export function getJsonSchemaType(zodType: any): string {
    if (!zodType || typeof zodType !== "object") return "string";

    // Recursively unwrap schema wrappers (Optional, Nullable, Default, Effects, Catch, Readonly, Pipeline, etc.)
    let current = zodType;
    while (current && current._def) {
        const typeName = current._def.typeName;
        if (typeName === "ZodOptional" || typeName === "ZodNullable" || typeName === "ZodDefault" || typeName === "ZodCatch" || typeName === "ZodReadonly") {
            current = current._def.innerType;
        } else if (typeName === "ZodEffects") {
            current = current._def.schema;
        } else if (typeName === "ZodPipeline") {
            current = current._def.out || current._def.in;
        } else {
            break;
        }
    }

    const typeName = current?._def?.typeName || "";
    if (typeName === "ZodNumber") return "number";
    if (typeName === "ZodBoolean") return "boolean";
    if (typeName === "ZodArray") return "array";
    if (typeName === "ZodObject") return "object";
    if (typeName === "ZodString") return "string";

    return "string"; // Default fallback
}

/**
 * Coerces numeric strings ("50" -> 50) and boolean strings ("true" -> true) recursively into JS primitives.
 */
export function tryCoerce(args: unknown): unknown {
    if (typeof args === "string") {
        if (args === "true") return true;
        if (args === "false") return false;
        if (/^-?\d+(\.\d+)?$/.test(args)) return Number(args);
        return args;
    }
    if (Array.isArray(args)) {
        return args.map(tryCoerce);
    }
    if (typeof args === "object" && args !== null) {
        const copy: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(args)) {
            copy[key] = tryCoerce(value);
        }
        return copy;
    }
    return args;
}

