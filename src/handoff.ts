// src/handoff.ts
import { z } from "zod";
import { defineTool, type Tool } from "./tool.js";
import type { Agent } from "./runner.js";
import type { AgentEvent, Message } from "./types.js";

export type HandoffContextMode = "full" | "summary" | "none";

export interface HandoffOptions {
  /**
   * Short identifier used to build the tool name (`handoff_<id>`).
   * Provide this OR `name` — not both required.
   */
  id?: string;
  /** Explicit tool name the parent agent will call. Overrides auto-generated name. */
  name?: string;
  /** Shown to the parent model — describe what this agent is for and when to use it. */
  description: string;
  /** The specialist agent to delegate to. */
  agent: Agent;
  /**
   * How much of the parent conversation to preserve for the sub-agent.
   * "full" (default) | "summary" | "none"
   */
  context?: HandoffContextMode;
  /** @deprecated Use `context` instead. */
  contextMode?: HandoffContextMode;
  /** Forwarded to the sub-agent's run() so you can observe its inner events too. */
  onEvent?: (e: AgentEvent) => void;
  maxTurns?: number;
}

/**
 * Wraps another Agent as a tool. Calling it runs the sub-agent to completion
 * (via Agent.spawn(), so the parent's own context/tools are untouched) and
 * returns its final answer as plain text.
 */
export function createHandoff(options: HandoffOptions): Tool {
  const contextMode = options.context ?? options.contextMode ?? "full";
  const toolName = options.name ?? `handoff_${options.id ?? slugify(options.description)}`;

  return defineTool({
    name: toolName,
    description: options.description,
    repairable: false,
    schema: z.object({
      task: z.string().describe("The specific task or question to hand off to this agent"),
    }),
    async execute({ task }, ctx) {
      const seedMessages = buildSeedMessages(contextMode, ctx.parentContext?.getMessages() ?? []);

      const subAgent = options.agent.spawn(seedMessages);
      const result = await subAgent.run(task, { onEvent: options.onEvent, maxTurns: options.maxTurns });

      return result.text || "(sub-agent returned no text)";
    },
  });
}

/** Shorthand for createHandoff — pass agent + description, optional id. */
export function handoff(agent: Agent, description: string, opts: Omit<HandoffOptions, "agent" | "description"> = {}): Tool {
  return createHandoff({ ...opts, agent, description });
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  return slug || "agent";
}

function buildSeedMessages(mode: HandoffContextMode, parentMessages: Message[]): Message[] {
  if (mode === "none" || parentMessages.length === 0) return [];

  let messages: Message[] = [];

  if (mode === "full") {
    messages = parentMessages.map((m) => structuredClone(m));
  } else {
    const lines = parentMessages
      .flatMap((m) =>
        m.content
          .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
          .map((b) => `${m.role}: ${b.text}`)
      )
      .slice(-6);

    if (lines.length > 0) {
      messages = [{ role: "user", content: [{ type: "text", text: `Context from the prior conversation:\n${lines.join("\n")}` }] }];
    }
  }

  return resolvePendingToolCalls(messages);
}

function resolvePendingToolCalls(messages: Message[]): Message[] {
  const result: Message[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    result.push(m);

    if (m.role === "assistant") {
      const toolCalls = m.content.filter((b): b is Extract<typeof b, { type: "tool_call" }> => b.type === "tool_call");
      if (toolCalls.length > 0) {
        const nextMsg = messages[i + 1];
        const existingToolResultIds = new Set(
          nextMsg?.role === "tool"
            ? nextMsg.content
                .filter((b): b is Extract<typeof b, { type: "tool_result" }> => b.type === "tool_result")
                .map((b) => b.toolCallId)
            : []
        );

        const unresponded = toolCalls.filter((tc) => !existingToolResultIds.has(tc.id));
        if (unresponded.length > 0) {
          result.push({
            role: "tool",
            content: unresponded.map((tc) => ({
              type: "tool_result",
              toolCallId: tc.id,
              name: tc.name,
              result: JSON.stringify({ status: "transferred", task: tc.arguments }),
              isError: false,
            })),
          });
        }
      }
    }
  }

  return result;
}

