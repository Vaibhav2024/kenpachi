// logger.ts — shared event logger for demos
import type { AgentEvent } from "./src/index.js";

const ICONS: Partial<Record<AgentEvent["type"], string>> = {
  turn_start: "🔄",
  text_delta: "💬",
  tool_call_start: "🔧",
  tool_call: "⚡",
  tool_result: "✅",
  tool_repair_attempt: "🩹",
  rollback_start: "⏪",
  rollback_step: "↩️",
  model_response: "🤖",
  run_end: "🏁",
};

export function createLogger(prefix = "kenpachi") {
  return (event: AgentEvent) => {
    const icon = ICONS[event.type] ?? "•";
    switch (event.type) {
      case "turn_start":
        console.log(`${icon} [${prefix}] Turn ${event.turnIndex} starting…`);
        break;
      case "text_delta":
        // process.stdout.write(event.text);
        break;
      case "tool_call_start":
        console.log(`${icon} [${prefix}] Model is calling tool: ${event.name}`);
        break;
      case "tool_call":
        console.log(`${icon} [${prefix}] Executing ${event.name}`, event.arguments);
        break;
      case "tool_result":
        console.log(
          `${icon} [${prefix}] ${event.name} →`,
          event.isError ? `ERROR: ${event.result}` : event.result
        );
        break;
      case "tool_repair_attempt":
        console.log(
          `${icon} [${prefix}] Self-healing ${event.name} (attempt ${event.attempt}): ${event.error}`
        );
        break;
      case "rollback_start":
        console.log(`${icon} [${prefix}] ROLLBACK triggered: ${event.reason}`);
        break;
      case "rollback_step":
        console.log(
          `${icon} [${prefix}] Compensating ${event.toolName} — ${event.ok ? "OK" : "FAILED"}`
        );
        break;
      case "model_response":
        console.log(`${icon} [${prefix}] Model finished this turn`);
        break;
      case "run_end":
        console.log(`${icon} [${prefix}] Run complete (${event.stopReason})`);
        break;
      default:
        console.log(`${icon} [${prefix}]`, event);
    }
  };
}
