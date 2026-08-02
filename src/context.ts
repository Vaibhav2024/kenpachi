import type { ContextSnapshot, Message } from "./types.js";

export class AgentContext {
    private messages: Message[] = [];
    private history: ContextSnapshot[] = [];
    private turnIndex = 0;

    constructor(systemPrompt?: string, private readonly system: string | undefined = systemPrompt) { }

    getSystem(): string | undefined {
        return this.system;
    }

    getMessages(): Message[] {
        return this.messages;
    }

    push(message: Message): void {
        this.messages.push(message)
    }

    /** Call this once per completed turn to record a restore point. */

    snapshot(label?: string): ContextSnapshot {
        const snap: ContextSnapshot = {
            turnIndex: this.turnIndex++,
            messages: structuredClone(this.messages),
            createdAt: Date.now(),
            label,
        };
        this.history.push(snap);
        return snap
    }

    listSnapshots(): ContextSnapshot[] {
        return this.history;
    }

    /**
    * Time-travel: truncate the message log back to the state right after
    * turn `turnIndex`, and drop every snapshot after it. Returns a NEW
    * AgentContext so the original run's history is untouched — you can
    * branch multiple times from the same point.
    */

    branchAt(turnIndex: number): AgentContext {
        const snap = this.history.find((s) => s.turnIndex === turnIndex);
        if (!snap) {
            throw new Error(
                `No snapshot at turnIndex ${turnIndex}. Available: ${this.history.map((s) => s.turnIndex).join(", ")}`
            );
        }
        const branched = new AgentContext(this.system);
        branched.messages = structuredClone(snap.messages);
        branched.history = this.history.filter((s) => s.turnIndex <= turnIndex).map((s) => ({...s}));
        branched.turnIndex = turnIndex + 1;
        return branched
    }

    /** Build a fresh context pre-seeded with the given messages (used by Agent.spawn). */
    static fromMessages(system: string | undefined, messages: Message[]): AgentContext {
        const ctx = new AgentContext(system);
        for (const m of messages) ctx.push(structuredClone(m));
        return ctx;
    }
}