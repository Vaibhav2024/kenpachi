// examples/3-self-healing.ts
import { z } from "zod";
import { Agent, defineTool } from "../src/index.js";
import { createScriptedProvider, textTurn, toolCallTurn } from "../tests/fakes.js";

const multiply = defineTool({
    name: "multiply",
    description: "Multiplies two numbers",
    schema: z.object({ a: z.number(), b: z.number() }),
    async execute({ a, b }) {
        return a * b;
    },
});

async function main() {
    // Model "mistakenly" sends numbers as strings — self-healing coerces them.
    const provider = createScriptedProvider([
        toolCallTurn("multiply", { a: "6", b: "7" }),
        textTurn("6 x 7 = 42"),
    ]);

    const agent = new Agent(provider, [multiply]);
    await agent.run("multiply 6 and 7", {
        onEvent: (e) => {
            if (e.type === "tool_repair_attempt") console.log("Repairing:", e.error);
        },
    });
}

main();