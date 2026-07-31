import { z } from "zod";
import type { AgentEvent, AgentRunOptions, Message, ModelProvider } from "./types.js";
import { AgentContext } from "./context.js";
import { toToolSchema, type Tool, type ToolContext } from "./tool.js";

export interface AgentRunResult {
    /** Plain text string extracted from the assistant's final response. */
    text: string;
    /** Full assistant message block. */
    message: Message;
    /** Backward compatibility getter for existing tests checking result.content */
    readonly content: Message["content"];
    /** Full message history up to this snapshot. */
    history: Message[];
}

export class Agent {
    private readonly tools: Map<string, Tool>;

    constructor(
        private readonly provider: ModelProvider,
        tools: Tool[],
        public readonly context: AgentContext = new AgentContext()
    ) {
        this.tools = new Map(tools.map((t) => [t.name, t]));
    }

    /** Run until the model stops calling tools, or maxTurns is hit. */
    async run(userInput: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
        const maxTurns = options.maxTurns ?? 8;
        const maxRepairAttempts = options.maxToolRepairAttempts ?? 2;
        const emit = (e: AgentEvent) => options.onEvent?.(e);

        this.context.push({ role: "user", content: [{ type: "text", text: userInput }] });

        let lastAssistantMessage: Message | null = null;

        for (let turn = 0; turn < maxTurns; turn++) {
            emit({ type: "turn_start", turnIndex: turn });

            const result = await this.provider.createTurn({
                system: this.context.getSystem(),
                messages: this.context.getMessages(),
                tools: [...this.tools.values()].map(toToolSchema),
            });

            this.context.push(result.message);
            emit({ type: "model_response", message: result.message });
            lastAssistantMessage = result.message;

            const toolCalls = Array.isArray(result.message.content)
                ? result.message.content.filter((b) => b.type === "tool_call")
                : [];

            if (toolCalls.length === 0) {
                this.context.snapshot(`turn-${turn}-end`);
                emit({ type: "run_end", stopReason: result.stopReason });
                return this.buildRunResult(result.message);
            }

            // --- execute tool calls this turn, with self-healing + rollback ---
            const completed: { toolName: string; undo?: () => Promise<void> }[] = [];
            const toolResults: Message["content"] = [];
            let sagaFailed: { toolName: string; error: string } | null = null;

            for (const call of toolCalls) {
                if (call.type !== "tool_call") continue;
                const tool = this.tools.get(call.name);

                if (!tool) {
                    toolResults.push({
                        type: "tool_result",
                        toolCallId: call.id,
                        name: call.name,
                        result: `Unknown tool "${call.name}"`,
                        isError: true,
                    });
                    continue;
                }

                emit({ type: "tool_call", name: call.name, arguments: call.arguments });

                const outcome = await this.executeWithRepair(tool, call.arguments, maxRepairAttempts, emit);

                if (!outcome.ok) {
                    toolResults.push({
                        type: "tool_result",
                        toolCallId: call.id,
                        name: call.name,
                        result: outcome.error,
                        isError: true,
                    });
                    emit({ type: "tool_result", name: call.name, result: outcome.error, isError: true });
                    sagaFailed = { toolName: call.name, error: outcome.error };
                    break; // stop executing further calls in this batch
                }

                toolResults.push({
                    type: "tool_result",
                    toolCallId: call.id,
                    name: call.name,
                    result: outcome.result,
                    isError: false,
                });

                emit({ type: "tool_result", name: call.name, result: outcome.result, isError: false });
                completed.push({ toolName: call.name, undo: outcome.undo });
            }

            if (sagaFailed && completed.some((c) => c.undo)) {
                emit({ type: "rollback_start", reason: sagaFailed.error });
                for (const step of [...completed].reverse()) {
                    if (!step.undo) continue;
                    try {
                        await step.undo();
                        emit({ type: "rollback_step", toolName: step.toolName, ok: true });
                    } catch (err) {
                        emit({ type: "rollback_step", toolName: step.toolName, ok: false });
                    }
                }
            }

            this.context.push({ role: "tool", content: toolResults });
            this.context.snapshot(`turn-${turn}-tools`);
        }

        emit({ type: "run_end", stopReason: "max_turns" });
        if (!lastAssistantMessage) {
            throw new Error("Agent.run exhausted maxTurns before receiving any assistant message");
        }
        return this.buildRunResult(lastAssistantMessage);
    }

    /** Constructs clean AgentRunResult while preserving backwards compatibility. */
    private buildRunResult(message: Message): AgentRunResult {
        const text = Array.isArray(message.content)
            ? message.content
                .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
                .map((b) => b.text)
                .join("\n")
            : String(message.content);

        return {
            text,
            message,
            get content() {
                return message.content;
            },
            history: this.context.getMessages(),
        };
    }

    /** Execute a tool; on Zod validation failure, feed the error back and retry. */
    private async executeWithRepair(
        tool: Tool,
        rawArgs: unknown,
        maxAttempts: number,
        emit: (e: AgentEvent) => void
    ): Promise<{ ok: true; result: unknown; undo?: () => Promise<void> } | { ok: false; error: string }> {
        let attempt = 0;
        let currentArgs = rawArgs;

        while (attempt <= maxAttempts) {
            const parsed = tool.schema.safeParse(currentArgs);

            if (!parsed.success) {
                const errorText = formatZodError(parsed.error);
                if (!tool.repairable || attempt === maxAttempts) {
                    return { ok: false, error: `Invalid arguments after ${attempt} repair attempt(s): ${errorText}` };
                }
                emit({ type: "tool_repair_attempt", name: tool.name, attempt: attempt + 1, error: errorText });
                currentArgs = tryCoerce(currentArgs, errorText);
                attempt++;
                continue;
            }

            let undo: (() => Promise<void>) | undefined;
            const ctx: ToolContext = {
                metadata: {},
                registerCompensation: (fn) => {
                    undo = fn;
                },
            };

            try {
                const result = await tool.execute(parsed.data, ctx);
                return { ok: true, result, undo };
            } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
        }
        return { ok: false, error: "Exhausted repair attempts" };
    }
}

function formatZodError(error: z.ZodError): string {
    return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

/** Minimal best-effort coercion pass used between repair attempts. */
function tryCoerce(args: unknown, _errorText: string): unknown {
    if (typeof args !== "object" || args === null) return args;
    const copy: Record<string, unknown> = { ...(args as Record<string, unknown>) };
    for (const key of Object.keys(copy)) {
        const value = copy[key];
        if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
            copy[key] = Number(value);
        }
    }
    return copy;
}