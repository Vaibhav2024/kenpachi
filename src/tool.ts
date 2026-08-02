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

/**
 * Universal Zod schema serializer converting ZodType into standard JSON Schema object.
 * Strips non-standard outer fields like $schema.
 */
export function serializeZodSchema(schema: z.ZodTypeAny): Record<string, unknown> {
    if (!schema) {
        return { type: "object", properties: {} };
    }

    const rawSchema = zodToJsonSchemaLib(schema, { target: "openAi" }) as Record<string, unknown>;

    // Strip non-standard outer fields like $schema
    const { $schema, ...cleanSchema } = rawSchema;

    const properties = (cleanSchema.properties as Record<string, unknown>) ?? {};
    const required = (cleanSchema.required as string[]) ?? [];

    return {
        type: "object",
        properties,
        ...(Array.isArray(required) && required.length > 0 ? { required } : {}),
        ...cleanSchema,
    };
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