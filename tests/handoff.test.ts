// tests/handoff.test.ts
import { describe, it, expect } from "vitest";
import { Agent } from "../src/runner.js";
import { createHandoff, handoff } from "../src/handoff.js";
import { createScriptedProvider, textTurn, toolCallTurn } from "./fakes.js";

describe("createHandoff", () => {
    it("delegates to the sub-agent and returns its text as the tool result", async () => {
        const billingProvider = createScriptedProvider([textTurn("Your balance is $42.")]);
        const billingAgent = new Agent(billingProvider, []);

        const billingHandoff = createHandoff({
            id: "billing",
            description: "Delegate billing questions",
            agent: billingAgent,
            context: "none",
        });

        const triageProvider = createScriptedProvider([
            toolCallTurn("handoff_billing", { task: "What's my balance?" }),
            textTurn("The billing agent says: Your balance is $42."),
        ]);
        const triageAgent = new Agent(triageProvider, [billingHandoff]);

        const events: any[] = [];
        const result = await triageAgent.run("What's my balance?", { onEvent: (e) => events.push(e) });

        expect(result.content[0]).toEqual({ type: "text", text: "The billing agent says: Your balance is $42." });
        const toolResult = events.find((e) => e.type === "tool_result");
        expect(toolResult.result).toBe("Your balance is $42.");
    });

    it("handoff() shorthand auto-generates tool name from description", async () => {
        const subProvider = createScriptedProvider([textTurn("done")]);
        const subAgent = new Agent(subProvider, []);

        const billingHandoff = handoff(subAgent, "Delegate billing questions", { id: "billing" });

        expect(billingHandoff.name).toBe("handoff_billing");
    });

    it("preserves parent context when context is 'full'", async () => {
        let seenMessageCount = 0;
        const subProvider = createScriptedProvider([textTurn("ack")]);
        const inspectingProvider = {
            ...subProvider,
            async createTurn(input: any) {
                seenMessageCount = input.messages.length;
                return subProvider.createTurn(input);
            },
        };
        const subAgent = new Agent(inspectingProvider as any, []);

        const specialistHandoff = createHandoff({
            id: "specialist",
            description: "test",
            agent: subAgent,
            context: "full",
        });

        const parentProvider = createScriptedProvider([
            toolCallTurn("handoff_specialist", { task: "continue" }),
            textTurn("done"),
        ]);
        const parentAgent = new Agent(parentProvider, [specialistHandoff]);

        await parentAgent.run("first message", {});

        expect(seenMessageCount).toBe(4);
    });
});
