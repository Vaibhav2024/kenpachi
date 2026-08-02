import type { Message, ModelProvider, ModelTurnResult, ToolSchema, ContentBlock, StreamChunk } from "../types.js";
import { parseSSE } from "./sse.js";

export function createAnthropicProvider(opts: {
    apiKey: string;
    model?: string;
}): ModelProvider {
    const model = opts.model ?? "claude-sonnet-4-6";

    return {
        name: "anthropic",
        async createTurn({ system, messages, tools }): Promise<ModelTurnResult> {
            const body = {
                model,
                max_tokens: 4096,
                system,
                messages: messages.map(toAnthropicMessage),
                tools: tools.map(toAnthropicTool)
            };

            const res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-api-key": opts.apiKey,
                    "anthropic-version": "2023-06-01"
                },
                body: JSON.stringify(body)
            })

            if (!res.ok) {
                const text = await res.text();
                throw new Error(`Anthropic API error ${res.status}: ${text}`)
            }

            const data = await res.json();
            return fromAnthropicResponse(data)
        },

        async *streamTurn({ system, messages, tools }): AsyncGenerator<StreamChunk, void, unknown> {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-api-key": opts.apiKey,
                    "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                    model,
                    max_tokens: 4096,
                    system,
                    messages: messages.map(toAnthropicMessage),
                    tools: tools.map(toAnthropicTool),
                    stream: true,
                }),
            });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(`Anthropic API error ${res.status}: ${text}`);
            }

            const blocks: Array<{ type: "text" | "tool_call"; text?: string; id?: string; name?: string }> = [];
            const rawToolInput: Record<number, string> = {};
            let stopReason: "end_turn" | "tool_use" | "max_tokens" = "end_turn";
            let inputTokens = 0;
            let outputTokens = 0;

            for await (const evt of parseSSE(res)) {
                const payload = JSON.parse(evt.data);

                switch (payload.type) {
                    case "message_start":
                        inputTokens = payload.message?.usage?.input_tokens ?? 0;
                        break;

                    case "content_block_start":
                        if (payload.content_block.type === "tool_use") {
                            blocks[payload.index] = { type: "tool_call", id: payload.content_block.id, name: payload.content_block.name };
                            rawToolInput[payload.index] = "";
                            yield { type: "tool_call_start", id: payload.content_block.id, name: payload.content_block.name };
                        } else {
                            blocks[payload.index] = { type: "text", text: "" };
                        }
                        break;

                    case "content_block_delta":
                        if (payload.delta.type === "text_delta") {
                            blocks[payload.index].text = (blocks[payload.index].text ?? "") + payload.delta.text;
                            yield { type: "text_delta", text: payload.delta.text };
                        } else if (payload.delta.type === "input_json_delta") {
                            rawToolInput[payload.index] += payload.delta.partial_json;
                            yield {
                                type: "tool_call_args_delta",
                                id: blocks[payload.index].id!,
                                jsonDelta: payload.delta.partial_json,
                            };
                        }
                        break;

                    case "message_delta":
                        if (payload.delta?.stop_reason) {
                            stopReason = payload.delta.stop_reason === "tool_use" ? "tool_use" : "end_turn";
                        }
                        if (payload.usage?.output_tokens) outputTokens = payload.usage.output_tokens;
                        break;

                    default:
                        break;
                }
            }

            const content = blocks.map((b, i) =>
                b.type === "text"
                    ? { type: "text" as const, text: b.text ?? "" }
                    : { type: "tool_call" as const, id: b.id!, name: b.name!, arguments: JSON.parse(rawToolInput[i] || "{}") }
            );

            yield {
                type: "turn_complete",
                result: {
                    message: { role: "assistant", content },
                    stopReason,
                    usage: { inputTokens, outputTokens },
                },
            };
        },
    }
}

function toAnthropicMessage(m: Message) {
    return {
        role: m.role === "tool" ? "user" : m.role,
        content: m.content.map((block: ContentBlock) => {
            if (block.type === "text") return { type: "text", text: block.text }
            if (block.type === "tool_call") {
                return { type: "tool_use", id: block.id, name: block.name, input: block.arguments }
            }
            return {
                type: "tool_result",
                tool_use_id: block.toolCallId,
                content: JSON.stringify(block.result),
                is_error: block.isError ?? false
            }
        })
    }
}

function toAnthropicTool(t: ToolSchema) {
    return { name: t.name, description: t.description, input_schema: t.parameters }
}

function fromAnthropicResponse(data: any): ModelTurnResult {
    const content: ContentBlock[] = data.content.map((block: any) => {
        if (block.type === "text") return { type: "text", text: block.text };
        return { type: "tool_call", id: block.id, name: block.name, arguments: block.input };
    })

    const stopReason = data.stop_reason === "tool_use" ? "tool_use" : data.stop_reason === "max_tokens" ? "max_tokens" : "end_turn"

    return {
        message: { role: "assistant", content},
        stopReason,
        usage: {inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0}
    }
}