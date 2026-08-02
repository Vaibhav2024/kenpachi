// tests/demo-03-anthropic-tools.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { defineTool, toToolSchema, serializeZodSchema } from "../src/tool.js";
import { createAnthropicProvider } from "../src/providers/anthropic.js";

const getWeatherForecast = defineTool({
  name: "get_weather_forecast",
  description: "Get weather forecast for a city for a specified number of days.",
  schema: z.object({
    city: z.string().describe("The target city name"),
    forecastDays: z.number().describe("Number of forecast days"),
  }),
  async execute({ city, forecastDays }) {
    return {
      city,
      forecastDays,
      forecast: Array.from({ length: forecastDays }, (_, i) => ({
        day: i + 1,
        condition: "sunny",
        tempC: 25 + i,
      })),
    };
  },
});

describe("Demo 03 — Anthropic Tool Serialization & Invocation", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should serialize Zod schema dynamically and format Anthropic input_schema correctly", async () => {
    const mockAnthropicResponse = {
      id: "msg_demo_03",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_forecast_01",
          name: "get_weather_forecast",
          input: {
            city: "Tokyo",
            forecastDays: 3,
          },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 45, output_tokens: 30 },
    };

    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockAnthropicResponse,
    });

    const provider = createAnthropicProvider({
      apiKey: "test-anthropic-key",
      model: "claude-3-5-sonnet-20241022",
    });

    const toolSchema = toToolSchema(getWeatherForecast);

    // 1. Verify serializeZodSchema outputs clean JSON Schema
    const serialized = serializeZodSchema(getWeatherForecast.schema);
    expect(serialized.type).toBe("object");
    expect(serialized.properties).toHaveProperty("city");
    expect(serialized.properties).toHaveProperty("forecastDays");
    expect((serialized.properties as any).city.type).toBe("string");
    expect((serialized.properties as any).forecastDays.type).toBe("number");
    expect(serialized.required).toEqual(["city", "forecastDays"]);
    expect(serialized.$schema).toBeUndefined();

    // 2. Trigger provider.createTurn
    const result = await provider.createTurn({
      system: "You are a weather assistant.",
      messages: [{ role: "user", content: [{ type: "text", text: "What is the 3-day weather forecast for Tokyo?" }] }],
      tools: [toolSchema],
    });

    // 3. Inspect fetch request sent to Anthropic API
    const [url, options] = (globalThis.fetch as any).mock.calls[0];
    const requestBody = JSON.parse(options.body);

    // Verify URL & headers
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(options.headers["x-api-key"]).toBe("test-anthropic-key");
    expect(options.headers["anthropic-version"]).toBe("2023-06-01");

    // Verify tools array in HTTP payload sent to Anthropic
    expect(requestBody.tools).toHaveLength(1);
    const sentTool = requestBody.tools[0];

    expect(sentTool.name).toBe("get_weather_forecast");
    expect(sentTool.input_schema.type).toBe("object");

    // Key requirement: parameters defined in z.object (city, forecastDays) must be dynamically converted
    expect(sentTool.input_schema.properties).toHaveProperty("city");
    expect(sentTool.input_schema.properties).toHaveProperty("forecastDays");
    expect(sentTool.input_schema.properties.city.type).toBe("string");
    expect(sentTool.input_schema.properties.forecastDays.type).toBe("number");
    expect(sentTool.input_schema.required).toEqual(["city", "forecastDays"]);
    expect(sentTool.input_schema.$schema).toBeUndefined();

    // Verify turn 0 tool execution invoked with exact keys defined in Zod schema
    expect(result.stopReason).toBe("tool_use");
    expect(result.message.content[0]).toEqual({
      type: "tool_call",
      id: "toolu_forecast_01",
      name: "get_weather_forecast",
      arguments: {
        city: "Tokyo",
        forecastDays: 3,
      },
    });
  });
});
