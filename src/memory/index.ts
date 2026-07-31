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
        const q = query.toLowerCase();
        return this.records
            .filter((r) => r.content.toLowerCase().includes(q))
            .slice(-limit)
            .reverse();
    }

    async clear(): Promise<void> {
        this.records = [];
    }
}

export { Mem0MemoryStore } from "./mem0.js";