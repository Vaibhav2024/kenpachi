# Phase 2 Syntax Guide

This document covers **new APIs** added in Phase 2 (streaming + handoffs) and
**simplifications** made on top of the original spec. Nothing from Phase 1
changed unless noted below.

---

## What stayed the same

| API | Still works? |
|-----|--------------|
| `agent.run(input, options)` | ✅ Returns `AgentRunResult` with `.text`, `.message`, `.content`, `.history` |
| `defineTool(...)`, `AgentContext`, providers | ✅ Unchanged |
| `onEvent` callback | ✅ Still fires for all events |

---

## Streaming

### New: `agent.stream(input, options?)`

Async generator that yields every `AgentEvent` as the run progresses, then
returns the same `AgentRunResult` that `run()` would.

```typescript
for await (const event of agent.stream("Hello")) {
  if (event.type === "text_delta") process.stdout.write(event.text);
}
// generator completes with AgentRunResult — access via the return value:
const gen = agent.stream("Hello");
let result;
while (true) {
  const { value, done } = await gen.next();
  if (done) { result = value; break; }
}
console.log(result.text);
```

### New: `onText` shorthand (simpler than full events)

If you only care about streaming text — not tool events — skip `stream()` and
use `onText` on `run()`:

```typescript
// Before (Phase 1 — still works)
await agent.run("Hello", {
  onEvent: (e) => {
    if (e.type === "model_response") { /* only fires after full turn */ }
  },
});

// After (Phase 2 — token-level streaming without async generator)
await agent.run("Hello", {
  onText: (chunk) => process.stdout.write(chunk),
});
```

### New event types

| Event | When |
|-------|------|
| `text_delta` | Incremental text from the model |
| `tool_call_start` | Model started a tool call |
| `tool_call_args_delta` | Partial JSON args streaming in |

All existing events (`turn_start`, `tool_call`, `tool_result`, etc.) are unchanged.

---

## Handoffs

### New: `handoff(agent, description, options?)` — recommended

Shortest form. Auto-generates the tool name as `handoff_<id>`.

```typescript
import { handoff } from "kenpachi-sdk";

const billingHandoff = handoff(billingAgent, "Use for billing questions", {
  id: "billing",           // → tool name: handoff_billing
  context: "none",         // optional: "full" | "summary" | "none"
});
```

### Alternative: `createHandoff(options)`

Full form when you need an explicit tool name:

```typescript
import { createHandoff } from "kenpachi-sdk";

const billingHandoff = createHandoff({
  name: "handoff_to_billing",   // explicit name (overrides id)
  description: "Use for billing questions",
  agent: billingAgent,
  context: "full",              // was `contextMode` in the spec — both work
});
```

### Simplifications vs the original spec

| Original spec | This SDK |
|---------------|----------|
| `name: "handoff_to_billing"` required | Use `id: "billing"` or let description slugify |
| `contextMode: "full"` | Prefer shorter `context: "full"` (`contextMode` still accepted) |
| Tool returns `{ delegatedTo, response }` | Returns **plain text string** — use `result.text` on the parent run, or read `tool_result.result` directly |
| Must use `createHandoff` | `handoff()` shorthand available |

### Context modes

| Value | What the sub-agent sees |
|-------|-------------------------|
| `"full"` (default) | Entire parent message history |
| `"summary"` | Last 6 text lines as a digest |
| `"none"` | Only the delegated `task` string |

### Tool result shape

```typescript
// Handoff tool returns plain text, not an object:
const events = [];
await triageAgent.run("What's my balance?", { onEvent: (e) => events.push(e) });
const toolResult = events.find(e => e.type === "tool_result");
console.log(toolResult.result); // "Your balance is $42."
```

---

## Agent.spawn(seedMessages?)

Creates a copy of the agent (same provider + tools, fresh context). Used
internally by handoffs; you can also call it directly:

```typescript
const sub = mainAgent.spawn(parentMessages);
const result = await sub.run("continue this task");
```

---

## Provider streaming

Both `createAnthropicProvider` and `createOpenAIProvider` now implement
optional `streamTurn()`. No config changes needed — `agent.stream()` and
`onText` automatically use streaming when available.

Scripted fakes for tests:

```typescript
import { createScriptedStreamingProvider } from "./tests/fakes.js";
const provider = createScriptedStreamingProvider([textTurn("Hello")]);
```

---

## Migration checklist

- [ ] Replace verbose `onEvent` text handling with `onText` where appropriate
- [ ] Replace manual `name: "handoff_to_*"` with `handoff(agent, desc, { id })`
- [ ] Update code reading `toolResult.result.response` → `toolResult.result` (plain string)
- [ ] Use `context` instead of `contextMode` in new code (old name still works)
