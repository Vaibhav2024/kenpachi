import type { Message, ModelProvider, ModelTurnResult, ToolSchema, ContentBlock } from "../types.js";

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
        }
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