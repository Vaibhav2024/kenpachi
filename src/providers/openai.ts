import type { Message, ModelProvider, ModelTurnResult } from "../types.js";

export function createOpenAIProvider(opts: { apiKey: string; model?: string }): ModelProvider {
    const model = opts.model ?? "gpt-4o-mini";

    return {
        name: "openai",
        async createTurn({ system, messages, tools }): Promise<ModelTurnResult> {
            const chatMessages = [
                ...(system ? [{ role: "system", content: system }] : []),
                ...messages.flatMap(toOpenAIMessages),
            ];

            // 1. Format tools cleanly
            const formattedTools = tools.map((t) => ({
                type: "function" as const,
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                },
            }));

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