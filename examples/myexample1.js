import dotenv from "dotenv";
dotenv.config({ path: "./.env" })

import { Agent, createOpenAIProvider } from "kenpachi";

const agent = new Agent(
    createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY })
)

const result = await agent.run("Write a one sentence greeting")
console.log(result.text)