// tests/context.test.ts
import { describe, it, expect } from "vitest";
import { AgentContext } from "../src/context.js";

describe("AgentContext time-travel", () => {
    it("branches back to an earlier snapshot without mutating the original", () => {
        const ctx = new AgentContext("system prompt");
        ctx.push({ role: "user", content: [{ type: "text", text: "first" }] });
        ctx.snapshot(); // turnIndex 0

        ctx.push({ role: "assistant", content: [{ type: "text", text: "reply" }] });
        ctx.push({ role: "user", content: [{ type: "text", text: "second" }] });
        ctx.snapshot(); // turnIndex 1

        const branched = ctx.branchAt(0);

        expect(branched.getMessages()).toHaveLength(1);
        expect(ctx.getMessages()).toHaveLength(3);

        branched.push({ role: "assistant", content: [{ type: "text", text: "different reply" }] });
        expect(ctx.getMessages()).toHaveLength(3); // original untouched
    });

    it("throws when branching to a turnIndex with no snapshot", () => {
        const ctx = new AgentContext();
        expect(() => ctx.branchAt(5)).toThrow(/No snapshot/);
    });
});