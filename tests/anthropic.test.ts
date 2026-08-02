// tests/anthropic.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAnthropicProvider } from "../src/providers/anthropic.js";
import { z } from "zod";
import { defineTool } from "../src/tool.js";

describe("Anthropic Provider", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        // Mock global fetch
        globalThis.fetch = vi.fn();
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("should format system prompt and tools correctly for Anthropic API", async () => {
        const mockResponse = {
            id: "msg_123",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "Hello from Claude!" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 5 },
        };

        // 1. Mock fetch returning a 200 OK HTTP response
        (globalThis.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse,
        });

        const provider = createAnthropicProvider({ apiKey: "fake-key", model: "claude-sonnet-4-6" });

        // 2. Execute createTurn
        const result = await provider.createTurn({
            system: "You are a helpful assistant.",
            messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
            tools: [
                {
                    name: "get_weather",
                    description: "Get weather",
                    parameters: { type: "object", properties: { city: { type: "string" } } },
                },
            ],
        });

        // 3. Inspect what HTTP body was sent to Anthropic
        const [url, options] = (globalThis.fetch as any).mock.calls[0];
        const body = JSON.parse(options.body);

        expect(url).toBe("https://api.anthropic.com/v1/messages");
        expect(options.headers["x-api-key"]).toBe("fake-key");
        expect(options.headers["anthropic-version"]).toBe("2023-06-01");

        // Anthropic-specific assertions
        expect(body.system).toBe("You are a helpful assistant."); // Top-level system prompt
        expect(body.tools[0].name).toBe("get_weather");
        expect(body.tools[0].input_schema).toBeDefined(); // Anthropic expects input_schema

        // Output parsing assertion
        expect(result.message.content).toEqual([{ type: "text", text: "Hello from Claude!" }]);
        expect(result.stopReason).toBe("end_turn");
    });

    it("should parse Anthropic tool_use responses correctly", async () => {
        const mockToolUseResponse = {
            id: "msg_456",
            type: "message",
            role: "assistant",
            content: [
                {
                    type: "tool_use",
                    id: "toolu_01A",
                    name: "get_weather",
                    input: { city: "Nashik" },
                },
            ],
            stop_reason: "tool_use",
            usage: { input_tokens: 15, output_tokens: 20 },
        };

        (globalThis.fetch as any).mockResolvedValueOnce({
            ok: true,
            json: async () => mockToolUseResponse,
        });

        const provider = createAnthropicProvider({ apiKey: "fake-key", model: "claude-sonnet-4-6" });
        const result = await provider.createTurn({
            messages: [{ role: "user", content: [{ type: "text", text: "Weather in Nashik?" }] }],
            tools: [],
        });

        // Check if Anthropic tool_use is parsed into your SDK's standard tool_call format
        expect(result.stopReason).toBe("tool_use");
        expect(result.message.content).toEqual([
            {
                type: "tool_call",
                id: "toolu_01A",
                name: "get_weather",
                arguments: { city: "Nashik" },
            },
        ]);
    });
});