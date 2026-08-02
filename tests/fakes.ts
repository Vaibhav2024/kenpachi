// tests/fakes.ts
import type { Message, ModelProvider, ModelTurnResult, ToolSchema, StreamChunk } from "../src/types.js";

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

/** Turns a ModelTurnResult into the StreamChunk sequence a real provider would emit. */
export function createScriptedStreamingProvider(script: ModelTurnResult[]): ModelProvider {
    let i = 0;
    return {
        name: "scripted-streaming-fake",
        async createTurn() {
            throw new Error("This fake only implements streamTurn — use createScriptedProvider for non-streaming tests");
        },
        async *streamTurn(): AsyncGenerator<StreamChunk, void, unknown> {
            if (i >= script.length) throw new Error("Scripted streaming provider ran out of responses");
            const result = script[i++];

            for (const block of result.message.content) {
                if (block.type === "text") {
                    const mid = Math.ceil(block.text.length / 2);
                    if (block.text.slice(0, mid)) yield { type: "text_delta", text: block.text.slice(0, mid) };
                    if (block.text.slice(mid)) yield { type: "text_delta", text: block.text.slice(mid) };
                } else if (block.type === "tool_call") {
                    yield { type: "tool_call_start", id: block.id, name: block.name };
                    yield { type: "tool_call_args_delta", id: block.id, jsonDelta: JSON.stringify(block.arguments) };
                }
            }

            yield { type: "turn_complete", result };
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