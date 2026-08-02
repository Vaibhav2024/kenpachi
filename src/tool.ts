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

    // 1. Primary Strategy: Try zod-to-json-schema first (cleanest output for Anthropic & OpenAI)
    try {
        const raw = zodToJsonSchemaLib(schema, {
            $refStrategy: "none",
            target: "jsonSchema7",
        }) as any;

        const properties =
            raw.properties ||
            raw.definitions?.root?.properties ||
            (Object.values(raw.definitions || {})[0] as any)?.properties;

        if (properties && Object.keys(properties).length > 0) {
            const required =
                raw.required ||
                raw.definitions?.root?.required ||
                (Object.values(raw.definitions || {})[0] as any)?.required ||
                Object.keys(properties);

            // Strip internal JSON Schema metadata so Anthropic/OpenAI accept it cleanly
            delete raw.$schema;
            delete raw.definitions;

            return {
                type: "object",
                properties,
                ...(required.length > 0 ? { required } : {}),
            };
        }
    } catch (err) {
        // Fall back to shape inspection if library fails
    }

    // 2. Secondary Strategy: Direct Zod Shape Inspection with dynamic types
    const shape = schema.shape || schema._def?.shape?.();
    if (shape) {
        const properties: Record<string, any> = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(shape)) {
            const valAny = value as any;
            const typeName = valAny?._def?.typeName;
            const isOptional = typeName === "ZodOptional";

            properties[key] = {
                type: getJsonSchemaType(valAny), // 👈 Dynamically determines "string", "number", "boolean", etc.
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

function getJsonSchemaType(zodType: any): string {
    const typeName = zodType?._def?.typeName || "";

    // Unwrap optional / nullable schemas
    if (typeName === "ZodOptional" || typeName === "ZodNullable") {
        return getJsonSchemaType(zodType._def.innerType);
    }
    if (typeName === "ZodNumber") return "number";
    if (typeName === "ZodBoolean") return "boolean";
    if (typeName === "ZodArray") return "array";
    if (typeName === "ZodObject") return "object";

    return "string"; // Default fallback
}
