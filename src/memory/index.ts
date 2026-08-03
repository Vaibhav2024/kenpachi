export interface MemoryRecord {
    id: string;
    content: string;
    metadata?: Record<string, unknown>;
    createdAt: number
}

export interface MemoryStore {
    add(content: string, metadata?: Record<string, unknown>): Promise<MemoryRecord>;
    search(query: String, limit?: number): Promise<MemoryRecord[]>
    clear(): Promise<void>;
}

/** Zero-dependency default: in-process, naive substring search. Fine for dev/tests. */
export class InMemoryStore implements MemoryStore {
    private records: MemoryRecord[] = [];

    async add(content: string, metadata?: Record<string, unknown>): Promise<MemoryRecord> {
        const record: MemoryRecord = { id: crypto.randomUUID(), content, metadata, createdAt: Date.now() };
        this.records.push(record);
        return record
    }

    async search(query: string, limit = 5): Promise<MemoryRecord[]> {
        if (this.records.length === 0) return [];

        const lowerQuery = query.toLowerCase();
        const queryTokens = lowerQuery.split(/\s+/).filter((t) => t.length > 1);

        const scored = this.records.map((r) => {
            const lowerItem = r.content.toLowerCase();
            let score = 0;

            for (const token of queryTokens) {
                if (lowerItem.includes(token)) {
                    score += 2;
                }
            }

            // Keyword boost for project/task/work queries
            if (
                (lowerQuery.includes("work") || lowerQuery.includes("project") || lowerQuery.includes("building") || lowerQuery.includes("doing") || lowerQuery.includes("task")) &&
                (lowerItem.includes("building") || lowerItem.includes("sdk") || lowerItem.includes("work") || lowerItem.includes("project") || lowerItem.includes("task"))
            ) {
                score += 3;
            }

            return { record: r, score };
        });

        const matches = scored.filter((s) => s.score > 0);

        // Fallback: If no token matched, return recent stored items up to limit
        if (matches.length === 0) {
            return this.records.slice(-limit).reverse();
        }

        return matches
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map((s) => s.record);
    }

    async clear(): Promise<void> {
        this.records = [];
    }
}

export { Mem0MemoryStore } from "./mem0.js";