// examples/6-rollback.ts
import { z } from "zod";
import { Agent, defineTool } from "../src/index.js";
import { createScriptedProvider, textTurn } from "../tests/fakes.js";
import type { Message, ModelTurnResult } from "../src/types.js";

function multiCall(calls: { name: string; args: unknown; id: string }[]): ModelTurnResult {
    const message: Message = {
        role: "assistant",
        content: calls.map((c) => ({ type: "tool_call", id: c.id, name: c.name, arguments: c.args })),
    };
    return { message, stopReason: "tool_use" };
}

async function main() {
    const reserveSeat = defineTool({
        name: "reserve_seat",
        description: "Reserves a seat",
        schema: z.object({ seatId: z.string() }),
        async execute({ seatId }, ctx) {
            console.log("Reserved", seatId);
            ctx.registerCompensation(async () => console.log("Released", seatId));
            return { reserved: seatId };
        },
    });

    const chargeCard = defineTool({
        name: "charge_card",
        description: "Charges a card",
        schema: z.object({ amount: z.number() }),
        async execute() {
            throw new Error("card declined");
        },
    });

    const provider = createScriptedProvider([
        multiCall([
            { name: "reserve_seat", args: { seatId: "12A" }, id: "1" },
            { name: "charge_card", args: { amount: 50 }, id: "2" },
        ]),
        textTurn("Sorry, payment failed — your seat hold was released."),
    ]);

    const agent = new Agent(provider, [reserveSeat, chargeCard]);
    const result = await agent.run("book seat 12A for $50");
    console.log(result.content);
}

main();