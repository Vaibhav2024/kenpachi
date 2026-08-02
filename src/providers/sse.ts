// src/providers/sse.ts

export interface SSEEvent {
  event?: string;
  data: string;
}

/**
 * Reads a fetch Response body as Server-Sent Events, yielding one SSEEvent
 * per `data:` payload. Works for both Anthropic-style (`event:` + `data:`
 * pairs separated by blank lines) and OpenAI-style (bare `data:` lines,
 * one JSON object per line, terminated by `data: [DONE]`) streams.
 */
export async function* parseSSE(response: Response): AsyncGenerator<SSEEvent, void, unknown> {
  if (!response.body) throw new Error("Response has no readable body to stream");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseEventBlock(rawEvent);
      if (parsed) yield parsed;
    }
  }

  // Flush any trailing partial block (some servers omit the final blank line).
  if (buffer.trim()) {
    const parsed = parseEventBlock(buffer);
    if (parsed) yield parsed;
  }
}

function parseEventBlock(block: string): SSEEvent | null {
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}
