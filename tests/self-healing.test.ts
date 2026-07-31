// tests/self-healing.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Agent } from "../src/runner.js";
import { defineTool } from "../src/tool.js";
import { createScriptedProvider, textTurn, toolCallTurn } from "./fakes.js";

describe("self-healing tool loop", () => {
    it("coerces a numeric-string argument instead of failing outright", async () => {
        const tool = defineTool({
            name: "double",
            description: "Doubles a number",
            schema: z.object({ n: z.number() }),
            async execute({ n }) {
                return n * 2;
            },
        });

        // Model sends "n": "21" (a string) — should be coerced and retried.
        const provider = createScriptedProvider([toolCallTurn("double", { n: "21" }), textTurn("42")]);

        const events: any[] = [];
        const agent = new Agent(provider, [tool]);
        const result = await agent.run("double 21", { onEvent: (e) => events.push(e) });

        expect(result.content[0]).toEqual({ type: "text", text: "42" });
        const repairEvent = events.find((e) => e.type === "tool_repair_attempt");
        expect(repairEvent).toBeDefined();
    });

    it("surfaces an error result after exhausting repair attempts on truly bad args", async () => {
        const tool = defineTool({
            name: "strict",
            description: "requires a valid email",
            schema: z.object({ email: z.string().email() }),
            async execute() {
                return "ok";
            },
        });

        const provider = createScriptedProvider([
            toolCallTurn("strict", { email: "not-an-email" }),
            textTurn("Sorry, that failed."),
        ]);

        const events: any[] = [];
        const agent = new Agent(provider, [tool]);
        await agent.run("do it", { onEvent: (e) => events.push(e), maxToolRepairAttempts: 1 });

        const toolResult = events.find((e) => e.type === "tool_result");
        expect(toolResult.isError).toBe(true);
    });
});