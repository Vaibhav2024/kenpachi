# kenpachi

A small, typed agent SDK for building tool-using LLM agents in TypeScript —
built from scratch on top of raw provider `fetch` calls (no vendor SDK
dependency) with a few things most minimal agent loops skip:

- **Time-travel context** — every turn is snapshotted; branch and resume from
  any prior point without re-calling the model for turns you already ran.
- **Self-healing tool calls** — malformed tool arguments are caught by Zod and
  repaired/retried instead of crashing the run.
- **Saga rollback** — register a compensating action per tool call; if a later
  step in the same batch fails, already-completed steps are undone in reverse.
- **KenpachiSDK dynamic tool synthesis** — the model can author pure-logic tools
  (math, parsing, formatting) at runtime. Anything needing a credential goes
  through a `ConnectorRegistry` you configure ahead of time — the model writes
  the glue code, never the secret.
- **Pluggable memory** — `InMemoryStore` by default, `Mem0MemoryStore` adapter
  included.

## Install

```bash
npm install kenpachi-sdk


## Quick start

```typescript
import { z } from "zod";
import { Agent, defineTool, createAnthropicProvider } from "kenpachi-sdk";

const getWeather = defineTool({
  name: "get_weather",
  description: "Get the current weather for a city",
  schema: z.object({ city: z.string() }),
  async execute({ city }) {
    return { city, tempC: 24, condition: "sunny" };
  },
});

const provider = createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });
const agent = new Agent(provider, [getWeather]);

const result = await agent.run("What's the weather in Nashik?");
console.log(result.content);
```

## Time-travel

```typescript
await agent.run("first message");
const snap = agent.context.listSnapshots().at(-1)!;

// Branch back to that point and try a different follow-up, without
// re-running the first exchange against the model.
const branched = agent.context.branchAt(snap.turnIndex);
```

## Dynamic tools with a connector registry

```typescript
import { ConnectorRegistry, synthesizeTool } from "kenpachi-sdk";

const registry = new ConnectorRegistry();
registry.register("weather", {
  baseUrl: "https://api.openweathermap.org/data/2.5",
  authEnvVar: "WEATHER_API_KEY", // secret lives in env, never in model output
  description: "OpenWeatherMap current conditions",
});

const tool = synthesizeTool(
  {
    name: "get_weather",
    description: "Fetches current weather for a city",
    parameters: { city: "string" },
    jsBody: `return await callConnector("/forecast?q=" + args.city);`,
    connector: "weather",
  },
  registry
);
```

## Security notes

- The sandbox (`src/sandbox.ts`) uses Node's `vm` module for **isolation**, not
  a hard security boundary. It blocks accidental misuse (stray `require`,
  filesystem access) but is not a substitute for OS-level sandboxing
  (a separate worker process, gVisor, Firecracker) if you're running untrusted
  model output in a real production deployment.
- Synthesized tools never receive raw secrets. Credentials are read from
  `process.env` inside the connector layer and injected into outgoing requests
  server-side — the model only ever sees the connector *name*.

## Development

```bash
npm install
npm run typecheck
npm run test
npm run build
```

## License

MIT