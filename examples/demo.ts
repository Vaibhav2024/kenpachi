import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
import { z } from "zod";
import { Agent, defineTool, createOpenAIProvider } from "../src/index.js";
import { createLogger } from "./logger.js";
import axios from "axios";

const apiKey = "";
if (!apiKey) throw new Error("Set OPENAI_API_KEY before running this demo");

const getWeather = defineTool({
    name: "get_weather",
    description: "Get current weather for a city",
    schema: z.object({ city: z.string() }),
    async execute({ city }) {
        const url = `https://wttr.in/${city.toLowerCase()}?format=%C+%t`;
        // Pass 'User-Agent: curl' and a timeout so wttr.in responds immediately
        const response = await axios.get(url, {
            responseType: 'text',
            headers: { 'User-Agent': 'curl/7.68.0' },
            timeout: 5000,
        });
        return JSON.stringify({ city, weatherInfo: response.data.trim() });
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

main().catch(console.error);
