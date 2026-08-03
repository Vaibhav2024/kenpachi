import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineTool, serializeZodSchema, tryCoerce } from "../src/tool.js";
import { Agent } from "../src/runner.js";
import { createScriptedProvider, textTurn, toolCallTurn } from "./fakes.js";

describe("Zod Schema Serialization and Pre-Coercion", () => {
    it("Test 1: serializes Zod object schema correctly mapping types (number, string, boolean)", () => {
        const schema = z.object({
            city: z.string(),
            amount: z.number(),
            active: z.boolean().optional(),
            count: z.number().default(10),
        });

        const serialized = serializeZodSchema(schema) as {
            type: string;
            properties: Record<string, { type: string }>;
            required?: string[];
        };

        expect(serialized.type).toBe("object");
        expect(serialized.properties.city.type).toBe("string");
        expect(serialized.properties.amount.type).toBe("number");
        expect(serialized.properties.active.type).toBe("boolean");
        expect(serialized.properties.count.type).toBe("number");
        expect(serialized.required).toContain("city");
        expect(serialized.required).toContain("amount");
        expect(serialized.required).not.toContain("active");
    });

    it("Test 1b: tryCoerce converts numeric and boolean strings recursively", () => {
        const input = {
            amount: "50",
            negative: "-12.5",
            isTrue: "true",
            isFalse: "false",
            text: "hello",
            nested: {
                count: "100",
            },
        };

        const coerced = tryCoerce(input);
        expect(coerced).toEqual({
            amount: 50,
            negative: -12.5,
            isTrue: true,
            isFalse: false,
            text: "hello",
            nested: {
                count: 100,
            },
        });
    });

    it("Test 2: executes tool with z.number() and z.boolean() successfully when passed stringified arguments", async () => {
        let executedArgs: any = null;

        const testTool = defineTool({
            name: "calculate",
            description: "Perform calculation",
            schema: z.object({
                amount: z.number(),
                applyTax: z.boolean(),
            }),
            async execute(args: { amount: number; applyTax: boolean }) {
                executedArgs = args;
                return { success: true, total: args.amount * (args.applyTax ? 1.1 : 1.0) };
            },
        });

        const provider = createScriptedProvider([
            toolCallTurn("calculate", { amount: "50", applyTax: "true" } as any),
            textTurn("Done with calculation"),
        ]);

        const agent = new Agent(provider, [testTool]);
        const result = await agent.run("calculate 50 with tax");

        expect(executedArgs).toEqual({ amount: 50, applyTax: true });
        expect(result.content[0]).toEqual({ type: "text", text: "Done with calculation" });
    });

    it("Test 2b: handles raw JSON string deltas passed as rawArgs", async () => {
        let executedArgs: any = null;

        const testTool = defineTool({
            name: "update_item",
            description: "Update item quantity",
            schema: z.object({
                qty: z.number(),
            }),
            async execute(args: { qty: number }) {
                executedArgs = args;
                return { updated: true };
            },
        });

        // Simulate streaming raw string argument from LLM delta
        const provider = createScriptedProvider([
            toolCallTurn("update_item", '{"qty": "42"}' as any),
            textTurn("Item updated"),
        ]);

        const agent = new Agent(provider, [testTool]);
        await agent.run("update qty to 42");

        expect(executedArgs).toEqual({ qty: 42 });
    });
});
