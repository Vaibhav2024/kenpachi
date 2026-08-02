// examples/1-basic-agent.ts
import { z } from "zod";
import { Agent, defineTool } from "../src/index.js";
import { createScriptedProvider, textTurn, toolCallTurn } from "../tests/fakes.js";

const weatherTool = defineTool({
    name: "get_weather",
    description: "Get current weather for a city",
    schema: z.object({ city: z.string() }),
    async execute({ city }) {
        return { city, tempC: 24, condition: "sunny" }; // stub — swap for a real connector
    },
});

async function main() {
    const provider = createScriptedProvider([
        toolCallTurn("get_weather", { city: "Nashik" }),
        textTurn("It's sunny and 24°C in Nashik."),
    ]);

    const agent = new Agent(provider, [weatherTool]);
    const result = await agent.run("What's the weather in Nashik?", {
        onEvent: (e) => console.log("[event]", e.type),
    });

    console.log("Final:", result.text);
}

main();