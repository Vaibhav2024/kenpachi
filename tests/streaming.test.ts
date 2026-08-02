// tests/streaming.test.ts
import { describe, it, expect } from "vitest";
import { Agent } from "../src/runner.js";
import { createScriptedStreamingProvider, textTurn } from "./fakes.js";

describe("Agent.stream", () => {
    it("yields text_delta events before the final message", async () => {
        const provider = createScriptedStreamingProvider([textTurn("Hello there!")]);
        const agent = new Agent(provider, []);

        const events: string[] = [];
        for await (const event of agent.stream("hi")) {
            events.push(event.type);
        }

        expect(events).toContain("text_delta");
        expect(events.filter((t) => t === "text_delta").length).toBeGreaterThan(1);
        expect(events.at(-1)).toBe("run_end");
    });

    it("agent.run() still works when the provider only supports streamTurn", async () => {
        const provider = createScriptedStreamingProvider([textTurn("Streamed answer")]);
        const agent = new Agent(provider, []);
        const result = await agent.run("question");
        expect(result.content[0]).toEqual({ type: "text", text: "Streamed answer" });
    });

    it("onText shorthand receives incremental text", async () => {
        const provider = createScriptedStreamingProvider([textTurn("Hello there!")]);
        const agent = new Agent(provider, []);
        const chunks: string[] = [];

        await agent.run("hi", { onText: (t) => chunks.push(t) });

        expect(chunks.join("")).toBe("Hello there!");
    });
});
