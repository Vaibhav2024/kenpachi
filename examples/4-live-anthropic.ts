// examples/4-live-openai.ts
// Requires: export OPENAI_API_KEY=sk-proj-...
import { z } from "zod";
import { Agent, defineTool, createOpenAIProvider } from "../src/index.js";

const calculate = defineTool({
  name: "calculate",
  description: "Evaluate a basic arithmetic expression",
  schema: z.object({ expression: z.string() }),
  async execute({ expression }) {
    // NOTE: Function constructor used only for this quick example
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${expression});`)();
  },
});

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Set OPENAI_API_KEY in your environment to run this example");

  const provider = createOpenAIProvider({ apiKey, model: "gpt-4o-mini" });
  const agent = new Agent(provider, [calculate]);

  console.log("Sending live request to OpenAI...");
  const result = await agent.run("What is (14 * 3) + 7?");
  
  console.log("\nFinal Answer:", result.text);
}

main();