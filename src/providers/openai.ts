import type { Message, ModelProvider, ModelTurnResult, StreamChunk, ToolSchema } from "../types.js";
import { parseSSE } from "./sse.js";

export function createOpenAIProvider(opts: { apiKey: string; model: string }): ModelProvider {
    const model = opts.model;

    return {
        name: "openai",
        async createTurn({ system, messages, tools }): Promise<ModelTurnResult> {
            const chatMessages = [
                ...(system ? [{ role: "system", content: system }] : []),
                ...messages.flatMap(toOpenAIMessages),
            ];

            // 1. Format tools cleanly
            const formattedTools = tools.map(toOpenAITool);

            // 2. Build payload - ONLY include `tools` if array is NOT empty
            const bodyPayload: Record<string, unknown> = {
                model,
                messages: chatMessages,
            };

            if (formattedTools.length > 0) {
                bodyPayload.tools = formattedTools;
            }

            const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${opts.apiKey}`,
                },
                body: JSON.stringify(bodyPayload),
            });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(`OpenAI API error ${res.status}: ${text}`);
            }

            const data = await res.json();
            return fromOpenAIResponse(data);
        },

        async *streamTurn({ system, messages, tools }): AsyncGenerator<StreamChunk, void, unknown> {
            const chatMessages = [
                ...(system ? [{ role: "system", content: system }] : []),
                ...messages.flatMap(toOpenAIMessages),
            ];

            const bodyPayload: Record<string, unknown> = {
                model,
                messages: chatMessages,
                stream: true,
            };

            const formattedTools = tools.map(toOpenAITool);

            if (formattedTools.length > 0) {
                bodyPayload.tools = formattedTools;
            }

            const res = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
                body: JSON.stringify(bodyPayload),
            });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(`OpenAI API error ${res.status}: ${text}`);
            }

            let textAcc = "";
            const toolCalls: Record<number, { id: string; name: string; argsJson: string }> = {};
            let finishReason = "stop";
            let inputTokens = 0;
            let outputTokens = 0;

            for await (const evt of parseSSE(res)) {
                if (evt.data === "[DONE]") continue;
                const payload = JSON.parse(evt.data);
                const choice = payload.choices?.[0];
                const delta = choice?.delta;

                if (payload.usage) {
                    inputTokens = payload.usage.prompt_tokens ?? inputTokens;
                    outputTokens = payload.usage.completion_tokens ?? outputTokens;
                }

                if (delta?.content) {
                    textAcc += delta.content;
                    yield { type: "text_delta", text: delta.content };
                }

                if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const i = tc.index;
                        if (!toolCalls[i]) {
                            toolCalls[i] = { id: tc.id ?? `call_${i}`, name: tc.function?.name ?? "", argsJson: "" };
                            if (tc.function?.name) {
                                yield { type: "tool_call_start", id: toolCalls[i].id, name: toolCalls[i].name };
                            }
                        }
                        if (tc.function?.arguments) {
                            toolCalls[i].argsJson += tc.function.arguments;
                            yield { type: "tool_call_args_delta", id: toolCalls[i].id, jsonDelta: tc.function.arguments };
                        }
                    }
                }

                if (choice?.finish_reason) finishReason = choice.finish_reason;
            }

            const content: Message["content"] = [];
            if (textAcc) content.push({ type: "text", text: textAcc });
            for (const tc of Object.values(toolCalls)) {
                content.push({ type: "tool_call", id: tc.id, name: tc.name, arguments: JSON.parse(tc.argsJson || "{}") });
            }

            yield {
                type: "turn_complete",
                result: {
                    message: { role: "assistant", content },
                    stopReason: finishReason === "tool_calls" ? "tool_use" : "end_turn",
                    usage: { inputTokens, outputTokens },
                },
            };
        },
    };
}

function toOpenAIMessages(m: Message): any[] {
    if (m.role === "tool") {
        return m.content
            .filter((b): b is Extract<typeof b, { type: "tool_result" }> => b.type === "tool_result")
            .map((b) => ({
                role: "tool",
                tool_call_id: b.toolCallId,
                content: typeof b.result === "string" ? b.result : JSON.stringify(b.result),
            }));
    }

    const text = m.content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n");

    const toolCalls = m.content
        .filter((b): b is Extract<typeof b, { type: "tool_call" }> => b.type === "tool_call")
        .map((b) => ({
            id: b.id,
            type: "function",
            function: { name: b.name, arguments: JSON.stringify(b.arguments) },
        }));

    return [
        {
            role: m.role,
            content: text || null,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
    ];
}

function fromOpenAIResponse(data: any): ModelTurnResult {
    // Fixed: OpenAI returns `choices` (plural)
    const choice = data.choices?.[0];
    if (!choice) {
        throw new Error("OpenAI API returned an empty choices array");
    }

    const msg = choice.message;
    const content: Message["content"] = [];

    if (msg.content) {
        content.push({ type: "text", text: msg.content });
    }

    for (const call of msg.tool_calls ?? []) {
        let parsedArgs = {};
        try {
            parsedArgs = typeof call.function.arguments === "string" 
                ? JSON.parse(call.function.arguments) 
                : call.function.arguments;
        } catch {
            parsedArgs = {};
        }

        content.push({
            type: "tool_call",
            id: call.id,
            name: call.function.name,
            arguments: parsedArgs,
        });
    }

    return {
        message: { role: "assistant", content },
        stopReason: choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
        usage: {
            inputTokens: data.usage?.prompt_tokens ?? 0,
            outputTokens: data.usage?.completion_tokens ?? 0,
        },
    };
}

function toOpenAITool(t: ToolSchema) {
    const params = t.parameters ?? {};
    const serializedProperties = (params.properties as Record<string, unknown>) ?? {};
    const serializedRequired = (params.required as string[]) ?? [];

    return {
        type: "function" as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: {
                type: "object" as const,
                properties: serializedProperties,
                ...(serializedRequired.length > 0 ? { required: serializedRequired } : {}),
            },
        },
    };
}