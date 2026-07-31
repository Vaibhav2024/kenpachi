// tests/runner.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Agent } from "../src/runner.js";
import { defineTool } from "../src/tool.js";
import { createScriptedProvider, textTurn, toolCallTurn } from "./fakes.js";

describe("Agent.run", () => {
    it("returns the final text turn when the model calls no tools", async () => {
        const provider = createScriptedProvider([textTurn("Hello there!")]);
        const agent = new Agent(provider, []);
        const result = await agent.run("hi");
        expect(result.content[0]).toEqual({ type: "text", text: "Hello there!" });
    });

    it("executes a tool call and feeds the result back", async () => {
        const addTool = defineTool({
            name: "add",
            description: "Add two numbers",
            schema: z.object({ a: z.number(), b: z.number() }),
            async execute({ a, b }) {
                return a + b;
            },
        });

        const provider = createScriptedProvider([
            toolCallTurn("add", { a: 2, b: 3 }),
            textTurn("The answer is 5."),
        ]);

        const events: string[] = [];
        const agent = new Agent(provider, [addTool]);
        const result = await agent.run("what is 2+3", { onEvent: (e) => events.push(e.type) });

        expect(result.content[0]).toEqual({ type: "text", text: "The answer is 5." });
        expect(events).toContain("tool_call");
        expect(events).toContain("tool_result");
    });
});