import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Agent } from "../src/runner.js";
import { defineTool } from "../src/tool.js";
import { handoff } from "../src/handoff.js";
import { sanitizeOpenAIMessages } from "../src/providers/openai.js";
import type { ModelProvider, ModelTurnResult } from "../src/types.js";

describe("Multi-Agent Handoff Message Ordering", () => {
    it("Test 1: sanitizeOpenAIMessages resolves missing tool response messages", () => {
        const rawMessages = [
            { role: "user", content: "I need tech support" },
            {
                role: "assistant",
                content: null,
                tool_calls: [
                    { id: "call_tech_001", type: "function", function: { name: "handoff_tech_support", arguments: '{"task":"wifi broken"}' } },
                ],
            },
            { role: "user", content: "wifi broken" },
        ];

        const sanitized = sanitizeOpenAIMessages(rawMessages);

        // Expect 4 messages: user, assistant(tool_calls), tool(tool_call_id), user
        expect(sanitized.length).toBe(4);
        expect(sanitized[0].role).toBe("user");
        expect(sanitized[1].role).toBe("assistant");
        expect(sanitized[2].role).toBe("tool");
        expect(sanitized[2].tool_call_id).toBe("call_tech_001");
        expect(sanitized[3].role).toBe("user");
    });

    it("Test 2: multi-agent handoff flow passes valid alternating messages to provider", async () => {
        const receivedTurnPayloads: any[] = [];

        // Specialist sub-agent
        const techAgentProvider: ModelProvider = {
            name: "mock-openai-tech",
            async createTurn({ messages }): Promise<ModelTurnResult> {
                receivedTurnPayloads.push({ agent: "tech", messages });
                return {
                    message: { role: "assistant", content: [{ type: "text", text: "Tech support here: router reset completed." }] },
                    stopReason: "end_turn",
                };
            },
        };
        const techAgent = new Agent(techAgentProvider);

        // Handoff tool
        const handoffTool = handoff(techAgent, "Transfer to tech support specialist", { id: "tech_support" });

        // Triage primary agent
        let triageTurn = 0;
        const triageAgentProvider: ModelProvider = {
            name: "mock-openai-triage",
            async createTurn({ messages }): Promise<ModelTurnResult> {
                triageTurn++;
                receivedTurnPayloads.push({ agent: "triage", turn: triageTurn, messages });

                if (triageTurn === 1) {
                    return {
                        message: {
                            role: "assistant",
                            content: [
                                {
                                    type: "tool_call",
                                    id: "call_triage_999",
                                    name: "handoff_tech_support",
                                    arguments: { task: "fix home wifi connection" },
                                },
                            ],
                        },
                        stopReason: "tool_use",
                    };
                }

                return {
                    message: { role: "assistant", content: [{ type: "text", text: "Handoff complete! Tech support assisted you." }] },
                    stopReason: "end_turn",
                };
            },
        };

        const triageAgent = new Agent(triageAgentProvider, [handoffTool]);
        const result = await triageAgent.run("My wifi is not working");

        expect(result.text).toContain("Handoff complete!");

        // Inspect tech agent's received messages
        const techPayload = receivedTurnPayloads.find((p) => p.agent === "tech");
        expect(techPayload).toBeDefined();

        const techMessages = techPayload.messages;
        // Verify that the assistant message with tool call is immediately followed by a tool response
        const assistantToolCallIndex = techMessages.findIndex(
            (m: any) => m.role === "assistant" && m.content.some((b: any) => b.type === "tool_call" && b.id === "call_triage_999")
        );
        expect(assistantToolCallIndex).toBeGreaterThan(-1);

        const nextMessage = techMessages[assistantToolCallIndex + 1];
        expect(nextMessage).toBeDefined();
        expect(nextMessage.role).toBe("tool");
        expect(nextMessage.content[0].toolCallId).toBe("call_triage_999");
    });
});
