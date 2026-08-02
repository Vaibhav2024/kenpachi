// examples/8-handoffs.ts
import { z } from "zod";
import { Agent, defineTool, handoff } from "../src/index.js";
import { createScriptedProvider, textTurn, toolCallTurn } from "../tests/fakes.js";

async function main() {
    const billingProvider = createScriptedProvider([textTurn("Your next payment is due on the 5th.")]);
    const billingAgent = new Agent(billingProvider, []);

    const restartTool = defineTool({
        name: "restart_service",
        description: "Restarts a named service",
        schema: z.object({ service: z.string() }),
        async execute({ service }) {
            return { service, status: "restarted" };
        },
    });
    const techProvider = createScriptedProvider([
        toolCallTurn("restart_service", { service: "api-gateway" }),
        textTurn("I restarted api-gateway — that should fix it."),
    ]);
    const techAgent = new Agent(techProvider, [restartTool]);

    // handoff() is the shortest form — agent + description + optional id
    const toBilling = handoff(billingAgent, "Use for billing, invoices, or payment questions", { id: "billing" });
    const toTech = handoff(techAgent, "Use for outages, errors, or service restarts", { id: "tech_support" });

    const triageProvider = createScriptedProvider([
        toolCallTurn("handoff_tech_support", { task: "The API gateway is down" }),
        textTurn("Tech support handled it — the api-gateway service was restarted."),
    ]);
    const triageAgent = new Agent(triageProvider, [toBilling, toTech]);

    const result = await triageAgent.run("The API gateway is down, please help", {
        onEvent: (e) => {
            if (e.type === "tool_call") console.log(`[triage] delegating via ${e.name}`);
            if (e.type === "tool_result") console.log(`[triage] got back:`, e.result);
        },
    });

    console.log("Final:", result.text);
}

main();
