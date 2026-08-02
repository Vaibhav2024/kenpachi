// src/runner.ts
import { z } from "zod";
import type { AgentEvent, AgentRunOptions, Message, ModelProvider, ModelTurnResult } from "./types.js";
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
    toolList: Tool[] = [],
    public readonly context: AgentContext = new AgentContext()
  ) {
    this.tools = new Map(toolList.map((t) => [t.name, t]));
  }

  getProvider(): ModelProvider {
    return this.provider;
  }

  getTools(): Tool[] {
    return [...this.tools.values()];
  }

  /**
   * New Agent sharing this agent's provider + tools, starting from a fresh
   * context optionally seeded with messages. Used by handoffs to preserve
   * context without mutating the parent agent.
   */
  spawn(seedMessages: Message[] = []): Agent {
    const ctx = AgentContext.fromMessages(this.context.getSystem(), seedMessages);
    return new Agent(this.provider, this.getTools(), ctx);
  }

  /** Runs to completion and returns the final assistant result. */
  async run(userInput: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    const gen = this.stream(userInput, options);
    let next = await gen.next();
    while (!next.done) {
      this.dispatchEvent(next.value, options);
      next = await gen.next();
    }
    return next.value;
  }

  /** Same loop as run(), yielding every event — including token-level deltas when available. */
  async *stream(userInput: string, options: AgentRunOptions = {}): AsyncGenerator<AgentEvent, AgentRunResult, unknown> {
    const maxTurns = options.maxTurns ?? 8;
    const maxRepairAttempts = options.maxToolRepairAttempts ?? 0;

    this.context.push({ role: "user", content: [{ type: "text", text: userInput }] });

    let lastAssistantMessage: Message | null = null;

    for (let turn = 0; turn < maxTurns; turn++) {
      yield { type: "turn_start", turnIndex: turn };

      const result = yield* this.getModelTurn(turn);
      this.context.push(result.message);
      yield { type: "model_response", message: result.message };
      lastAssistantMessage = result.message;

      const toolCalls = result.message.content.filter((b) => b.type === "tool_call");
      if (toolCalls.length === 0) {
        this.context.snapshot(`turn-${turn}-end`);
        yield { type: "run_end", stopReason: result.stopReason };
        return this.buildRunResult(result.message);
      }

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

        yield { type: "tool_call", name: call.name, arguments: call.arguments };

        const outcome = await this.executeWithRepair(tool, call.arguments, maxRepairAttempts, (e) => {
          repairEvents.push(e);
        });

        for (const e of repairEvents.splice(0)) yield e;

        if (!outcome.ok) {
          toolResults.push({ type: "tool_result", toolCallId: call.id, name: call.name, result: outcome.error, isError: true });
          yield { type: "tool_result", name: call.name, result: outcome.error, isError: true };
          sagaFailed = { toolName: call.name, error: outcome.error };
          break;
        }

        toolResults.push({ type: "tool_result", toolCallId: call.id, name: call.name, result: outcome.result, isError: false });
        yield { type: "tool_result", name: call.name, result: outcome.result, isError: false };
        completed.push({ toolName: call.name, undo: outcome.undo });
      }

      if (sagaFailed) {
        if (completed.some((c) => c.undo)) {
          yield { type: "rollback_start", reason: sagaFailed.error };
          for (const step of [...completed].reverse()) {
            if (!step.undo) continue;
            try {
              await step.undo();
              yield { type: "rollback_step", toolName: step.toolName, ok: true };
            } catch {
              yield { type: "rollback_step", toolName: step.toolName, ok: false };
            }
          }
        }
        this.context.push({ role: "tool", content: toolResults });
        this.context.snapshot(`turn-${turn}-tools-failed`);
        yield { type: "run_end", stopReason: "error" };
        return this.buildRunResult({
          role: "assistant",
          content: [{ type: "text", text: `Tool execution failed for ${sagaFailed.toolName}: ${sagaFailed.error}` }],
        });
      }

      this.context.push({ role: "tool", content: toolResults });
      this.context.snapshot(`turn-${turn}-tools`);
    }

    if (!lastAssistantMessage) {
      throw new Error("Agent.stream exhausted maxTurns before receiving any assistant message");
    }
    yield { type: "run_end", stopReason: "max_turns" };
    return this.buildRunResult(lastAssistantMessage);
  }

  private dispatchEvent(event: AgentEvent, options: AgentRunOptions): void {
    options.onEvent?.(event);
    if (event.type === "text_delta") options.onText?.(event.text);
  }

  /**
   * Gets one ModelTurnResult, streaming token-level events if the provider
   * supports streamTurn(); otherwise falls back to a single createTurn()
   * call and yields its text as one text_delta so downstream consumers of
   * stream() see a consistent event shape either way.
   */
  private async *getModelTurn(_turn: number): AsyncGenerator<AgentEvent, ModelTurnResult, unknown> {
    const input = {
      system: this.context.getSystem(),
      messages: this.context.getMessages(),
      tools: this.getTools().map(toToolSchema),
    };

    if (!this.provider.streamTurn) {
      const result = await this.provider.createTurn(input);
      const text = result.message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      if (text) yield { type: "text_delta", text };
      return result;
    }

    let finalResult: ModelTurnResult | undefined;
    for await (const chunk of this.provider.streamTurn(input)) {
      if (chunk.type === "text_delta") yield { type: "text_delta", text: chunk.text };
      else if (chunk.type === "tool_call_start") yield { type: "tool_call_start", id: chunk.id, name: chunk.name };
      else if (chunk.type === "tool_call_args_delta") {
        yield { type: "tool_call_args_delta", id: chunk.id, jsonDelta: chunk.jsonDelta };
      } else if (chunk.type === "turn_complete") {
        finalResult = chunk.result;
      }
    }

    if (!finalResult) throw new Error(`${this.provider.name}.streamTurn() ended without a turn_complete chunk`);
    return finalResult;
  }

  /** Constructs clean AgentRunResult while preserving backwards compatibility. */
  private buildRunResult(message: Message): AgentRunResult {
    const text = message.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return {
      text,
      message,
      get content() {
        return message.content;
      },
      history: this.context.getMessages(),
    };
  }

  /** Execute a tool; on Zod validation failure, retry with a light coercion pass. */
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
        currentArgs = tryCoerce(currentArgs);
        attempt++;
        continue;
      }

      let undo: (() => Promise<void>) | undefined;
      const ctx: ToolContext = {
        metadata: {},
        registerCompensation: (fn) => {
          undo = fn;
        },
        parentContext: this.context,
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

const repairEvents: AgentEvent[] = [];

function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

function tryCoerce(args: unknown): unknown {
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
