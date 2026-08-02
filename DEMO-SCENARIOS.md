# Kenpachi SDK — Demo & Real-World Testing Scenarios

Use this guide to test **kenpachi** the way a real user would — install the published package, run scenarios, and watch console logs that explain what the agent is doing at every step. Perfect for a YouTube walkthrough.

---

## Before You Record

### 1. Install like a real user

Create a fresh folder outside this repo so viewers see the published package, not local source:

```bash
mkdir kenpachi-demo && cd kenpachi-demo
npm init -y
npm install kenpachi zod tsx
```

For **all live LLM demos**, set an OpenAI API key:

```bash
# Windows PowerShell
$env:OPENAI_API_KEY = "sk-..."
```

### 2. Copy the shared event logger

Every scenario below uses this helper. Save it once as `logger.ts`:

```typescript
// logger.ts — paste into every demo file
import type { AgentEvent } from "kenpachi";

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
        // Uncomment for noisy token logs:
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
```

### 3. Quick reference — what each event means

| Event | What the viewer should understand |
|-------|-----------------------------------|
| `turn_start` | Agent loop iteration — model is thinking |
| `text_delta` | Streaming token (use `onText` or `stream()`) |
| `tool_call` | SDK is running a tool the model requested |
| `tool_repair_attempt` | Bad args caught by Zod → auto-repair retry |
| `rollback_start` | A tool in a batch failed → undo prior steps |
| `rollback_step` | One compensation (undo) ran |
| `run_end` | Agent finished |

### 4. Feature coverage checklist

| # | Scenario | SDK feature | API keys needed? |
|---|----------|-------------|------------------|
| 1 | Weather assistant | Basic agent + `defineTool` | Yes (OpenAI) |
| 2 | Streaming chat | `stream()`, `onText`, `text_delta` | Yes (OpenAI) |
| 3 | Broken JSON args | Self-healing / schema recovery | Yes (OpenAI) |
| 4 | Flight booking fail | Saga rollback + compensation | Yes (OpenAI) |
| 5 | Support triage | Multi-agent `handoff()` | Yes (OpenAI) |
| 6 | Regenerate answer | Time-travel / `branchAt()` | Yes (OpenAI) |
| 7 | User preferences | `InMemoryStore` + custom tools | Yes (OpenAI) |
| 8 | Runtime math tool | `synthesizeTool` + sandbox | Yes (OpenAI) |
| 9 | Live calculator | Real OpenAI provider | Yes |
| 10 | **Hero demo** | All features in one story | Yes (OpenAI) |

---

## Scenario 1 — Basic Agent + Typed Tools

**Story for video:** *"Every Kenpachi agent starts with typed tools. The model decides when to call them — we just observe."*

**Run from repo (no install):** `npm run example:1`

**Standalone demo** — save as `demo-01-basic.ts`:

```typescript
import { z } from "zod";
import { Agent, defineTool, createOpenAIProvider } from "kenpachi";
import { createLogger } from "./logger.js";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY before running this demo");

const getWeather = defineTool({
  name: "get_weather",
  description: "Get current weather for a city",
  schema: z.object({ city: z.string() }),
  async execute({ city }) {
    console.log(`   📡 Fetching weather for ${city}…`);
    // Stubbed — swap for a real weather API call
    return { city, tempC: 24, condition: "sunny" };
  },
});

async function main() {
  console.log("\n=== SCENARIO 1: Basic Agent + Tools ===\n");
  const log = createLogger("agent");

  const provider = createOpenAIProvider({ apiKey, model: "gpt-4o-mini" });
  const agent = new Agent(provider, [getWeather]);
  const result = await agent.run("What's the weather in Nashik?", { onEvent: log });

  console.log("\n📝 Final answer:", result.text);
}

main();
```

**What to highlight on screen:**
1. User message enters the agent
2. `tool_call` → weather tool runs
3. `tool_result` → structured JSON back to model
4. Final natural-language answer

---

## Scenario 2 — Streaming (Token-by-Token UX)

**Story:** *"Chat UIs need streaming. Kenpachi exposes every event — tokens, tool calls, everything."*

**Run from repo:** `npm run example:7`

**Standalone demo** — `demo-02-streaming.ts`:

```typescript
import { Agent, createOpenAIProvider } from "kenpachi";
import { createLogger } from "./logger.js";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY before running this demo");

async function main() {
  console.log("\n=== SCENARIO 2: Streaming ===\n");

  const provider = createOpenAIProvider({ apiKey, model: "gpt-4o-mini" });
  const agent = new Agent(provider, []);
  const log = createLogger("stream");

  // --- Method A: full async generator ---
  console.log("Method A — agent.stream():\n");
  process.stdout.write("Agent: ");
  for await (const event of agent.stream("Explain streaming LLM output in one sentence.")) {
    if (event.type === "text_delta") process.stdout.write(event.text);
    else log(event);
  }
  console.log("\n");

  // --- Method B: simpler onText shorthand ---
  console.log("Method B — run() with onText:\n");
  process.stdout.write("Agent: ");
  await agent.run("Give a different one-sentence explanation.", {
    onText: (chunk) => process.stdout.write(chunk),
    onEvent: (e) => {
      if (e.type !== "text_delta") log(e);
    },
  });
  console.log("\n");
}

main();
```

**Tip for video:** Split terminal — left side shows event logs, right side shows tokens appearing live.

---

## Scenario 3 — Self-Healing (Model Sends Wrong Types)

**Story:** *"LLMs often send `"42"` instead of `42`. Kenpachi catches it, repairs, and retries — no crash."*

This is your **"AI got it wrong → SDK fixed it"** moment without faking intelligence.

**Run from repo:** `npm run example:3`

**Standalone demo** — `demo-03-self-healing.ts`:

```typescript
import { z } from "zod";
import { Agent, defineTool, createOpenAIProvider } from "kenpachi";
import { createLogger } from "./logger.js";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY before running this demo");

const multiply = defineTool({
  name: "multiply",
  description: "Multiplies two numbers. Args must be numbers (not strings).",
  schema: z.object({ a: z.number(), b: z.number() }),
  async execute({ a, b }) {
    console.log(`   🧾e Computing ${a} × ${b}`);
    return { product: a * b };
  },
});

async function main() {
  console.log("\n=== SCENARIO 3: Self-Healing Tool Args ===\n");
  console.log("Asking the model to multiply — watch Kenpachi coerce any type mismatches…\n");

  const provider = createOpenAIProvider({ apiKey, model: "gpt-4o-mini" });
  const agent = new Agent(provider, [multiply]);
  const result = await agent.run("What is 6 times 7? Use the multiply tool.", {
    onEvent: createLogger("heal"),
  });

  console.log("\n📝 Final:", result.text);
  console.log("\n💡 If the model sent string args, Kenpachi coerced them automatically.");
}

main();
```

**Console moment to pause on:** the `🩹 tool_repair_attempt` line (if coercion needed) or show that execution succeeded despite wrong types.

---

## Scenario 3B — Universal Tool Schema Serializer (Anthropic + OpenAI)

**Story:** *"Zod tool definitions dynamically convert to provider-compliant JSON Schemas (`input_schema` for Anthropic, `parameters` for OpenAI), guaranteeing exact argument mapping without fallback key mismatches."*

**Standalone demo** — `demo-03-anthropic-tools.ts`:

```typescript
import { z } from "zod";
import { Agent, defineTool, createAnthropicProvider } from "kenpachi";
import { createLogger } from "./logger.js";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("Set ANTHROPIC_API_KEY before running this demo");

const getWeatherForecast = defineTool({
  name: "get_weather_forecast",
  description: "Get weather forecast for a city for a specified number of days.",
  schema: z.object({
    city: z.string().describe("The target city name"),
    forecastDays: z.number().describe("Number of forecast days"),
  }),
  async execute({ city, forecastDays }) {
    console.log(`   📡 Fetching ${forecastDays}-day forecast for ${city}…`);
    return { city, forecastDays, condition: "sunny", tempC: 25 };
  },
});

async function main() {
  console.log("\n=== SCENARIO 3B: Anthropic Dynamic Tool Schema Serializer ===\n");
  const log = createLogger("anthropic");

  const provider = createAnthropicProvider({ apiKey, model: "claude-3-5-sonnet-20241022" });
  const agent = new Agent(provider, [getWeatherForecast]);
  const result = await agent.run("What is the 3-day weather forecast for Tokyo?", { onEvent: log });

  console.log("\n📝 Final answer:", result.text);
}

main();
```

---

## Scenario 4 — Saga Rollback (Booking That Unwinds)

**Story:** *"Reserve seat → charge card. Card declines. Kenpachi rolls back the seat hold automatically."*

**Best dramatic demo in the SDK.** Pause on `rollback_start` and each `rollback_step`.

**Run from repo:** `npm run example:6`

**Standalone demo** — `demo-04-rollback.ts`:

```typescript
import { z } from "zod";
import { Agent, defineTool, createOpenAIProvider } from "kenpachi";
import { createLogger } from "./logger.js";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY before running this demo");

async function main() {
  console.log("\n=== SCENARIO 4: Saga Rollback ===\n");
  console.log("User asks to book seat 12A for $50…\n");

  const reserveSeat = defineTool({
    name: "reserve_seat",
    description: "Hold a seat temporarily by seatId",
    schema: z.object({ seatId: z.string() }),
    async execute({ seatId }, ctx) {
      console.log(`   🎫 Seat ${seatId} RESERVED`);
      ctx.registerCompensation(async () => {
        console.log(`   🔓 Seat ${seatId} RELEASED (compensation)`);
      });
      return { reserved: seatId, expiresIn: "15min" };
    },
  });

  const chargeCard = defineTool({
    name: "charge_card",
    description: "Charge the customer's card by dollar amount",
    schema: z.object({ amount: z.number() }),
    async execute({ amount }) {
      console.log(`   💳 Charging $${amount}…`);
      throw new Error("card declined — insufficient funds");
    },
  });

  const provider = createOpenAIProvider({ apiKey, model: "gpt-4o-mini" });
  const agent = new Agent(provider, [reserveSeat, chargeCard]);
  const result = await agent.run(
    "Book seat 12A for $50. First reserve the seat, then charge the card.",
    { onEvent: createLogger("booking") }
  );

  console.log("\n📝 Final:", result.text);
  console.log("\n💡 registerCompensation() = saga pattern. Failed later step → undo earlier steps.");
}

main();
```

---

## Scenario 5 — Multi-Agent Handoffs (Support Triage)

**Story:** *"One front-door agent. Billing specialist. Tech specialist. Parent delegates via handoff tools."*

**Run from repo:** `npm run example:8`

**Standalone demo** — `demo-05-handoffs.ts`:

```typescript
import { z } from "zod";
import { Agent, defineTool, handoff, createOpenAIProvider } from "kenpachi";
import { createLogger } from "./logger.js";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY before running this demo");

async function main() {
  console.log("\n=== SCENARIO 5: Multi-Agent Handoffs ===\n");

  const provider = createOpenAIProvider({ apiKey, model: "gpt-4o-mini" });

  // --- Specialist: Billing ---
  const billingAgent = new Agent(provider, []);

  // --- Specialist: Tech Support ---
  const restartService = defineTool({
    name: "restart_service",
    description: "Restart a named backend service",
    schema: z.object({ service: z.string() }),
    async execute({ service }) {
      console.log(`   🔄 Restarting ${service}…`);
      return { service, status: "restarted", latencyMs: 1200 };
    },
  });

  const techAgent = new Agent(provider, [restartService]);

  const toBilling = handoff(billingAgent, "Billing, invoices, payments", { id: "billing" });
  const toTech = handoff(techAgent, "Outages, errors, service restarts", {
    id: "tech_support",
    onEvent: createLogger("tech-sub"), // watch sub-agent internally
  });

  const triageAgent = new Agent(provider, [toBilling, toTech]);

  const result = await triageAgent.run("The API gateway is down, please help!", {
    onEvent: (e) => {
      const log = createLogger("triage");
      log(e);
      if (e.type === "tool_call" && e.name.startsWith("handoff_")) {
        console.log(`   🔀 Delegating to specialist via ${e.name}`);
      }
    },
  });

  console.log("\n📝 Final:", result.text);
}

main();
```

**Bonus talking point:** handoffs use `Agent.spawn()` — parent context stays untouched.

---

## Scenario 6 — Time-Travel (Regenerate Without Re-Running)

**Story:** *"User doesn't like the answer. Branch back to turn 1 and try a different path — without paying for turn 1 again."*

**Run from repo:** `npm run example:2`

**Standalone demo** — `demo-06-time-travel.ts`:

```typescript
import { Agent, createOpenAIProvider } from "kenpachi";
import { createLogger } from "./logger.js";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY before running this demo");

async function main() {
  console.log("\n=== SCENARIO 6: Time-Travel / Branching ===\n");

  const provider = createOpenAIProvider({ apiKey, model: "gpt-4o-mini" });
  const agent = new Agent(provider, []);

  console.log("Step 1 — Run first message\n");
  await agent.run("Tell me one fact about TypeScript in one sentence.", { onEvent: createLogger("main") });

  const snap = agent.context.listSnapshots().at(-1)!;
  console.log(`\n📸 Snapshot saved at turn ${snap.turnIndex} (${snap.label ?? "unlabeled"})\n`);

  console.log("Step 2 — Continue ORIGINAL conversation (path A)\n");
  await agent.run("Why should I use it? One sentence.", { onEvent: createLogger("main") });

  console.log("\nStep 3 — Branch back and try ALTERNATIVE (path B)\n");
  const branched = agent.context.branchAt(snap.turnIndex);
  const altAgent = new Agent(provider, [], branched);
  await altAgent.run("Give me a completely different angle on TypeScript. One sentence.", { onEvent: createLogger("branch") });

  console.log("\n--- Results ---");
  console.log("Original last reply:", agent.context.getMessages().at(-1)?.content[0]);
  console.log("Branched last reply:", altAgent.context.getMessages().at(-1)?.content[0]);
  console.log("\n💡 Same turn-1 history. Different turn-2. No duplicate API call for turn 1.");
}

main();
```

---

## Scenario 7 — Pluggable Memory (Remember the User)

**Story:** *"Memory isn't magic — you wire a store into tools. Kenpachi ships InMemoryStore and Mem0 adapter."*

**Run from repo:** `npm run example:5`

**Standalone demo** — `demo-07-memory.ts`:

```typescript
import { z } from "zod";
import { Agent, defineTool, InMemoryStore, createOpenAIProvider } from "kenpachi";
import { createLogger } from "./logger.js";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY before running this demo");

async function main() {
  console.log("\n=== SCENARIO 7: Memory ===\n");

  const memory = new InMemoryStore();

  const remember = defineTool({
    name: "remember",
    description: "Save an important fact about the user to memory",
    schema: z.object({ fact: z.string() }),
    async execute({ fact }) {
      console.log(`   💾 Saving: "${fact}"`);
      await memory.add(fact);
      return { saved: true };
    },
  });

  const recall = defineTool({
    name: "recall",
    description: "Search saved facts about the user from memory",
    schema: z.object({ query: z.string() }),
    async execute({ query }) {
      console.log(`   🔍 Searching memory for: "${query}"`);
      const hits = await memory.search(query, 3);
      return { results: hits.map((h) => h.content) };
    },
  });

  const provider = createOpenAIProvider({ apiKey, model: "gpt-4o-mini" });
  const agent = new Agent(provider, [remember, recall]);
  await agent.run("My name is Vaibhav and I'm building the Kenpachi SDK. Please remember that.", { onEvent: createLogger("memory") });
  const result = await agent.run("What am I working on?", { onEvent: createLogger("memory") });

  console.log("\n📝 Final:", result.text);
}

main();
```

---

## Scenario 8 — Runtime Tool Synthesis (Sandbox)

**Story:** *"Agent needs a one-off calculator. Model authors JS logic; Kenpachi runs it in an isolated sandbox."*

**Standalone demo** — `demo-08-synthesis.ts`:

```typescript
import { Agent, ConnectorRegistry, synthesizeTool, createOpenAIProvider } from "kenpachi";
import { createLogger } from "./logger.js";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY before running this demo");

async function main() {
  console.log("\n=== SCENARIO 8: Runtime Tool Synthesis ===\n");

  const registry = new ConnectorRegistry();
  registry.register("exchange_api", {
    baseUrl: "https://api.exchangerate.host",
    description: "Public exchange rates (demo — no key needed)",
  });

  // Pre-synthesized tool (in production, the model proposes via proposeToolSpecTool)
  const eurConverter = synthesizeTool(
    {
      name: "usd_to_eur",
      description: "Convert USD to EUR using the current exchange rate",
      parameters: { amountUsd: "number" },
      jsBody: `
        const rate = 0.92; // demo stub — swap for callConnector("/latest?base=USD")
        return { amountUsd: args.amountUsd, amountEur: +(args.amountUsd * rate).toFixed(2), rate };
      `,
    },
    registry
  );

  const provider = createOpenAIProvider({ apiKey, model: "gpt-4o-mini" });
  const agent = new Agent(provider, [eurConverter]);
  const result = await agent.run("Convert $100 to EUR", {
    onEvent: createLogger("sandbox"),
  });

  console.log("\n📝 Final:", result.text);
  console.log("\n💡 Secrets never enter the sandbox — ConnectorRegistry reads env vars on the host.");
}

main();
```

---

## Scenario 9 — Live Provider (Real API Call)

**Story:** *"Same API works with OpenAI or Anthropic — swap the provider, keep everything else."*

**Run from repo:** set `OPENAI_API_KEY` then run the live example file.

**Standalone demo** — `demo-09-live.ts`:

```typescript
import { z } from "zod";
import { Agent, defineTool, createOpenAIProvider } from "kenpachi";
import { createLogger } from "./logger.js";

const calculate = defineTool({
  name: "calculate",
  description: "Evaluate a basic arithmetic expression",
  schema: z.object({ expression: z.string() }),
  async execute({ expression }) {
    console.log(`   🧮 Evaluating: ${expression}`);
    // eslint-disable-next-line no-new-func
    return { result: Function(`"use strict"; return (${expression});`)() };
  },
});

async function main() {
  console.log("\n=== SCENARIO 9: Live LLM Provider ===\n");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Set OPENAI_API_KEY to run this demo");

  const provider = createOpenAIProvider({ apiKey, model: "gpt-4o-mini" });
  const agent = new Agent(provider, [calculate]);

  console.log("Sending live request…\n");
  const result = await agent.run("What is (14 * 3) + 7? Use the calculate tool.", {
    onEvent: createLogger("live"),
    onText: (t) => process.stdout.write(t),
  });

  console.log("\n\n📝 Final:", result.text);
}

main();
```

---

## Scenario 10 — Hero Demo (YouTube Grand Finale)

**Story arc for a 5–8 minute video:**

1. **Hook** — "Watch what happens when payment fails mid-booking" (Scenario 4 clip)
2. **Foundation** — Basic tools (Scenario 1)
3. **Resilience** — Self-healing args (Scenario 3) — *"The model sent wrong types; we didn't crash"*
4. **Streaming** — Token output (Scenario 2)
5. **Multi-agent** — Handoff to tech support (Scenario 5)
6. **Time-travel** — Regenerate answer (Scenario 6)
7. **Climax** — Combined booking + rollback + time-travel with live narration

**Combined script** — `demo-10-hero.ts`:

```typescript
import { z } from "zod";
import {
  Agent,
  defineTool,
  handoff,
  InMemoryStore,
  createOpenAIProvider,
} from "kenpachi";
import { createLogger } from "./logger.js";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY before running this demo");

const section = (n: number, title: string) =>
  console.log(`\n${"=".repeat(60)}\n  ACT ${n}: ${title}\n${"=".repeat(60)}\n`);

async function main() {
  console.log("\n🎦 KENPACHI SDK — FULL FEATURE DEMO\n");

  const provider = createOpenAIProvider({ apiKey, model: "gpt-4o-mini" });
  const memory = new InMemoryStore();
  await memory.add("User prefers window seats");

  // --- ACT 1: Triage agent with memory + handoff + rollback ---
  section(1, "Support triage remembers you + rollback on payment failure");

  const recallPref = defineTool({
    name: "recall_preference",
    description: "Look up stored user preferences by topic",
    schema: z.object({ topic: z.string() }),
    async execute({ topic }) {
      const hits = await memory.search(topic, 1);
      console.log(`   🧠 Memory hit:`, hits[0]?.content ?? "none");
      return { preference: hits[0]?.content ?? "no preference saved" };
    },
  });

  const bookingAgent = new Agent(
    provider,
    [
      defineTool({
        name: "reserve_seat",
        description: "Hold a seat by seatId. Register an undo in case payment fails.",
        schema: z.object({ seatId: z.string() }),
        async execute({ seatId }, ctx) {
          console.log(`   🎫 Reserved ${seatId}`);
          ctx.registerCompensation(async () => console.log(`   🔓 Released ${seatId}`));
          return { seatId, status: "held" };
        },
      }),
      defineTool({
        name: "charge_card",
        description: "Charge the card by dollar amount. This will always fail in this demo.",
        schema: z.object({ amount: z.number() }),
        async execute({ amount }) {
          console.log(`   💳 Charge $${amount}… DECLINED`);
          throw new Error("card declined");
        },
      }),
    ]
  );

  const toBooking = handoff(bookingAgent, "Flight and seat bookings", {
    id: "booking",
    onEvent: createLogger("booking-agent"),
  });

  const triage = new Agent(provider, [recallPref, toBooking]);

  await triage.run(
    "Book me a window seat 14F to Mumbai for $120. First recall my seat preference, then hand off to booking.",
    { onEvent: createLogger("triage") }
  );

  // --- ACT 2: Self-healing ---
  section(2, "Self-healing — Kenpachi coerces type mismatches");

  const multiply = defineTool({
    name: "multiply",
    description: "Multiply two numbers",
    schema: z.object({ a: z.number(), b: z.number() }),
    async execute({ a, b }) {
      return { product: a * b };
    },
  });

  await new Agent(provider, [multiply]).run(
    "What is 12 times 5? Use the multiply tool.",
    { onEvent: createLogger("heal") }
  );

  // --- ACT 3: Time-travel ---
  section(3, "Time-travel — branch to regenerate");

  const ttAgent = new Agent(provider, []);
  await ttAgent.run("Describe the Kenpachi SDK in one sentence.");
  const snap = ttAgent.context.listSnapshots().at(-1)!;
  await ttAgent.run("Tell me more about it.");
  console.log("Original path:", ttAgent.context.getMessages().at(-1)?.content[0]);

  const branched = ttAgent.context.branchAt(snap.turnIndex);
  const alt = new Agent(provider, [], branched);
  await alt.run("Give a completely different one-sentence description.");
  console.log("Regenerated path:", alt.context.getMessages().at(-1)?.content[0]);

  console.log("\n🏁 Demo complete — every major feature exercised.\n");
}

main();
```

---

## Scripted Fakes (Unit Testing / CI Only)

These fakes are used in the repo's own test suite. You don’t need them to run the demo scenarios — every scenario above uses the real OpenAI API. Copy this file if you want to write offline unit tests for your own agents:

```typescript
// fakes.ts — deterministic model responses for recording
import type { Message, ModelProvider, ModelTurnResult, StreamChunk } from "kenpachi";

export function createScriptedProvider(script: ModelTurnResult[]): ModelProvider {
  let i = 0;
  return {
    name: "scripted-fake",
    async createTurn() {
      if (i >= script.length) throw new Error("Script exhausted");
      return script[i++];
    },
  };
}

export function createScriptedStreamingProvider(script: ModelTurnResult[]): ModelProvider {
  let i = 0;
  return {
    name: "scripted-streaming-fake",
    async createTurn() {
      throw new Error("Use streamTurn");
    },
    async *streamTurn(): AsyncGenerator<StreamChunk, void, unknown> {
      if (i >= script.length) throw new Error("Script exhausted");
      const result = script[i++];
      for (const block of result.message.content) {
        if (block.type === "text") {
          const mid = Math.ceil(block.text.length / 2);
          if (block.text.slice(0, mid)) yield { type: "text_delta", text: block.text.slice(0, mid) };
          if (block.text.slice(mid)) yield { type: "text_delta", text: block.text.slice(mid) };
        } else if (block.type === "tool_call") {
          yield { type: "tool_call_start", id: block.id, name: block.name };
          yield { type: "tool_call_args_delta", id: block.id, jsonDelta: JSON.stringify(block.arguments) };
        }
      }
      yield { type: "turn_complete", result };
    },
  };
}

export function textTurn(text: string): ModelTurnResult {
  return { message: { role: "assistant", content: [{ type: "text", text }] }, stopReason: "end_turn" };
}

export function toolCallTurn(name: string, args: unknown, id = "call_1"): ModelTurnResult {
  return {
    message: { role: "assistant", content: [{ type: "tool_call", id, name, arguments: args }] },
    stopReason: "tool_use",
  };
}
```

Run any demo with:

```bash
npx tsx demo-04-rollback.ts
```

---

## Suggested YouTube Video Structure

| Timestamp | Content | Command / file |
|-----------|---------|----------------|
| 0:00 | Hook — rollback in action | `demo-04-rollback.ts` |
| 0:45 | What is Kenpachi (15 sec) | Slide / README |
| 1:00 | Install + basic agent | `demo-01-basic.ts` |
| 2:00 | Streaming tokens | `demo-02-streaming.ts` |
| 2:45 | Self-healing (wrong types fixed) | `demo-03-self-healing.ts` |
| 3:30 | Handoffs — specialist agents | `demo-05-handoffs.ts` |
| 4:30 | Time-travel regenerate | `demo-06-time-travel.ts` |
| 5:15 | Memory + synthesis (quick) | `demo-07-memory.ts` |
| 6:00 | Live API proof | `demo-09-live.ts` |
| 6:45 | Hero recap | `demo-10-hero.ts` |
| 7:30 | CTA — npm install, docs link | — |

---

## Recording Tips

1. **Terminal** — Use a dark theme, large font (18–20px). Increase window width so logs don’t wrap.
2. **Color** — Pipe through `npx tsx demo.ts 2>&1` or use a tool like `script` to capture clean output.
3. **Pause on events** — When `rollback_start` or `tool_repair_attempt` fires, stop and explain in voiceover.
4. **Split screen** — Code on left, terminal on right for the hero demo.
5. **API key** — All scenarios 1–10 require `OPENAI_API_KEY`. Set it before recording.
6. **Model cost** — All demos use `gpt-4o-mini` for low cost. Swap to `gpt-4o` for higher quality.

---

## Repo Shortcuts (Developers)

If you're still inside the **kenpachi-sdk** repo during development:

```bash
npm run example:1   # basic agent
npm run example:2   # time-travel
npm run example:3   # self-healing
npm run example:5   # memory
npm run example:6   # rollback
npm run example:7   # streaming
npm run example:8   # handoffs
npm run test        # full test suite (CI proof)
```

---

## Docs & Links

- **Published docs:** https://kenpachi.mintlify.site/introduction
- **npm package:** `kenpachi` (v0.2.2)
- **GitHub:** https://github.com/Vaibhav2024/kenpachi

---

*Generated for Kenpachi SDK demo / YouTube production testing.*
