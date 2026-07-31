// tests/fakes.ts
import type { Message, ModelProvider, ModelTurnResult, ToolSchema } from "../src/types.js";

/** Scripted provider: returns queued responses in order, one per call. */
export function createScriptedProvider(script: ModelTurnResult[]): ModelProvider {
    let i = 0;
    return {
        name: "scripted-fake",
        async createTurn(_input: { system?: string; messages: Message[]; tools: ToolSchema[] }) {
            if (i >= script.length) {
                throw new Error("Scripted provider ran out of responses");
            }
            return script[i++];
        },
    };
}

export function textTurn(text: string): ModelTurnResult {
    return { message: { role: "assistant", content: [{ type: "text", text }] }, stopReason: "end_turn" };
}

export function toolCallTurn(name: string, args: unknown, id = "call_1"): ModelTurnResult {
    return {
        message: { role: "assistant", content: [{ type: "tool_call", id, name, arguments: args }] },
        stopReason: "tool_use",
    };
}