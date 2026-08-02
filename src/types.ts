// src/types.ts

/** A single message in the conversation. */
export type Role = "system" | "user" | "assistant" | "tool";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolCallBlock {
  type: "tool_call";
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolResultBlock {
  type: "tool_result";
  toolCallId: string;
  name: string;
  result: unknown;
  isError?: boolean;
}

export type ContentBlock = TextBlock | ToolCallBlock | ToolResultBlock;

export interface Message {
  role: Role;
  content: ContentBlock[];
}

/** What a provider returns for one model turn. */
export interface ModelTurnResult {
  message: Message;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "error";
  usage?: { inputTokens: number; outputTokens: number };
}

/** The provider-agnostic interface every LLM adapter implements. */
export interface ModelProvider {
  name: string;
  /**
   * Send the full message history (+ available tool schemas) and get back
   * exactly one assistant turn. The runner drives the loop; the provider
   * just does one call.
   */
  createTurn(input: {
    system?: string;
    messages: Message[];
    tools: ToolSchema[];
  }): Promise<ModelTurnResult>;

  /**
   * Optional: same contract as createTurn, but yields incremental chunks as
   * the model generates them, finishing with a `turn_complete` chunk that
   * carries the same ModelTurnResult createTurn() would have returned.
   * Providers that don't implement this fall back to createTurn() inside
   * Agent.stream() — see runner.ts.
   */
  streamTurn?(input: {
    system?: string;
    messages: Message[];
    tools: ToolSchema[];
  }): AsyncGenerator<StreamChunk, void, unknown>;
}

/** JSON-schema-shaped description of a tool, sent to the model. */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
}

/** A snapshot of agent state at one point in time — see context.ts. */
export interface ContextSnapshot {
  turnIndex: number;
  messages: Message[];
  createdAt: number;
  label?: string;
}

export interface AgentRunOptions {
  maxTurns?: number;
  maxToolRepairAttempts?: number;
  onEvent?: (event: AgentEvent) => void;
  /** Shorthand for streaming text — called on each text_delta event. */
  onText?: (text: string) => void;
}

/** Incremental pieces a streaming provider emits mid-turn. */
export type StreamChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_args_delta"; id: string; jsonDelta: string }
  | { type: "turn_complete"; result: ModelTurnResult };

export type AgentEvent =
  | { type: "turn_start"; turnIndex: number }
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_args_delta"; id: string; jsonDelta: string }
  | { type: "model_response"; message: Message }
  | { type: "tool_call"; name: string; arguments: unknown }
  | { type: "tool_result"; name: string; result: unknown; isError: boolean }
  | { type: "tool_repair_attempt"; name: string; attempt: number; error: string }
  | { type: "rollback_start"; reason: string }
  | { type: "rollback_step"; toolName: string; ok: boolean }
  | { type: "handoff_start"; to: string; task: string }
  | { type: "handoff_end"; to: string }
  | { type: "run_end"; stopReason: string };
