// tests/rollback.test.ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Agent } from "../src/runner.js";
import { defineTool } from "../src/tool.js";
import { createScriptedProvider, textTurn } from "./fakes.js";
import type { Message, ModelTurnResult } from "../src/types.js";

function multiToolCallTurn(calls: { name: string; args: unknown; id: string }[]): ModelTurnResult {
    const message: Message = {
        role: "assistant",
        content: calls.map((c) => ({ type: "tool_call", id: c.id, name: c.name, arguments: c.args })),
    };
    return { message, stopReason: "tool_use" };
}

describe("saga rollback", () => {
    it("undoes a completed step when a later step in the same batch fails", async () => {
        const undone: string[] = [];

        const reserveSeat = defineTool({
            name: "reserve_seat",
            description: "Reserves a seat",
            schema: z.object({ seatId: z.string() }),
            async execute({ seatId }, ctx) {
                ctx.registerCompensation(async () => {
                    undone.push(seatId);
                });
                return { reserved: seatId };
            },
        });

        const chargeCard = defineTool({
            name: "charge_card",
            description: "Charges a card (always fails in this test)",
            schema: z.object({ amount: z.number() }),
            async execute() {
                throw new Error("card declined");
            },
        });

        const provider = createScriptedProvider([
            multiToolCallTurn([
                { name: "reserve_seat", args: { seatId: "12A" }, id: "call_1" },
                { name: "charge_card", args: { amount: 50 }, id: "call_2" },
            ]),
            textTurn("Booking failed, seat released."),
        ]);

        const events: any[] = [];
        const agent = new Agent(provider, [reserveSeat, chargeCard]);
        await agent.run("book seat 12A", { onEvent: (e) => events.push(e) });

        expect(undone).toEqual(["12A"]);
        expect(events.some((e) => e.type === "rollback_start")).toBe(true);
    });
});