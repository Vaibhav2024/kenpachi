import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../src/memory/index.js";

describe("InMemoryStore search logic", () => {
    it("matches non-exact queries via tokenization and synonym heuristics", async () => {
        const store = new InMemoryStore();
        await store.add("User's name is Vaibhav and they are building the Kenpachi SDK.");
        await store.add("User prefers TypeScript over JavaScript.");

        const results = await store.search("working on");
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].content).toContain("building the Kenpachi SDK");
    });

    it("ranks higher relevance matches higher", async () => {
        const store = new InMemoryStore();
        await store.add("Favorite food is pizza.");
        await store.add("Working on building a web server in Rust.");
        await store.add("Working on building an AI agent SDK in TypeScript.");

        const results = await store.search("building AI agent SDK", 2);
        expect(results.length).toBe(2);
        expect(results[0].content).toContain("AI agent SDK");
    });

    it("falls back to recent memories when no query tokens match", async () => {
        const store = new InMemoryStore();
        await store.add("First fact: Likes dark mode.");
        await store.add("Second fact: Uses macOS.");
        await store.add("Third fact: Enjoys coffee.");

        const results = await store.search("unrelated xyz query", 2);
        expect(results.length).toBe(2);
        expect(results[0].content).toContain("Third fact");
        expect(results[1].content).toContain("Second fact");
    });

    it("returns empty array when store is empty", async () => {
        const store = new InMemoryStore();
        const results = await store.search("anything");
        expect(results).toEqual([]);
    });
});
