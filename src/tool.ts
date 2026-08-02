// src/tool.ts
import { Schema, z } from "zod";
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
    schema: z.ZodType<Args>
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
    schema: z.ZodType<Args>;
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

/** Convert a Zod schema to a JSON-schema-ish object good enough for prompting. */
export function zodToJsonSchema(schema: z.ZodType<any>): Record<string, unknown> {
    const def = (schema as any)._def;
    return {
        type: "object",
        properties: {
            expression: {
                type: "string",
                description: "The mathematical expression to evaluate, e.g. (14 * 3) + 7"
            }
        },
        required: ["expression"]
    };
}

function zodDefToJsonSchema(def: any): Record<string, unknown> {
    if (!def) return { type: "object", properties: {} };

    const typeName = def.typeName;

    switch (typeName) {
        case "ZodObject": {
            // Support both Zod v3 property shape and method shape
            const rawShape = typeof def.shape === "function" ? def.shape() : def.shape;
            const shape = rawShape ?? {};

            const properties: Record<string, unknown> = {};
            const required: string[] = [];

            for (const key of Object.keys(shape)) {
                const field = shape[key];
                if (!field) continue;

                const fieldDef = field._def;
                if (!fieldDef) continue;

                properties[key] = zodDefToJsonSchema(fieldDef);

                // Mark required if it is NOT optional or defaulted
                const isOptional = fieldDef.typeName === "ZodOptional" || fieldDef.typeName === "ZodDefault";
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
        case "ZodString":
            return { type: "string", ...(def.description ? { description: def.description } : {}) };
        case "ZodNumber":
            return { type: "number" };
        case "ZodBoolean":
            return { type: "boolean" };
        case "ZodArray":
            return { type: "array", items: zodDefToJsonSchema(def.type?._def) };
        case "ZodEnum":
            return { type: "string", enum: def.values };
        case "ZodOptional":
        case "ZodDefault":
            return zodDefToJsonSchema(def.innerType?._def);
        default:
            return { type: "string" };
    }
}

export function toToolSchema(tool: Tool): ToolSchema {
    return {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.schema),
    };
}