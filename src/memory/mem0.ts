import type { MemoryRecord, MemoryStore } from "./index.js";

/**
 * Adapter around mem0's HTTP API. Kept dependency-free (raw fetch) so
 * `zod` stays your only hard dependency — install `mem0ai` yourself only
 * if you want their official SDK instead of this thin wrapper.
 */

export class Mem0MemoryStore implements MemoryStore {
    constructor(
        private readonly opts: { apiKey: string; userId: string; baseUrl?: string }
    ) { }

    private get base() {
        return this.opts.baseUrl ?? "https://api.mem0.ai/v1"
    }

    async add(content: string, metadata?: Record<string, unknown>): Promise<MemoryRecord> {
        const res = await fetch(`${this.base}/memories/`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Token ${this.opts.apiKey}` },
            body: JSON.stringify({
                messages: [{ role: "user", content }],
                user_id: this.opts.userId,
                metadata,
            }),
        });
        if (!res.ok) throw new Error(`mem0 add failed: ${res.status} ${await res.text()}`);
        const data = await res.json();
        return { id: data.id ?? crypto.randomUUID(), content, metadata, createdAt: Date.now() };
    }

    async search(query: string, limit = 5): Promise<MemoryRecord[]> {
        const res = await fetch(`${this.base}/memories/search/`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Token ${this.opts.apiKey}` },
            body: JSON.stringify({ query, user_id: this.opts.userId, limit }),
        });
        if (!res.ok) throw new Error(`mem0 search failed: ${res.status} ${await res.text()}`);
        const data = await res.json();
        return (data.results ?? data).map((m: any) => ({
            id: m.id,
            content: m.memory ?? m.content,
            metadata: m.metadata,
            createdAt: Date.parse(m.created_at ?? "") || Date.now(),
        }));
    }

    async clear(): Promise<void> {
        await fetch(`${this.base}/memories/?user_id=${this.opts.userId}`, {
            method: "DELETE",
            headers: { authorization: `Token ${this.opts.apiKey}` },
        });
    }
}