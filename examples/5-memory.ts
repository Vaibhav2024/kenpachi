// examples/5-memory.ts
import { InMemoryStore } from "../src/index.js";

async function main() {
    const memory = new InMemoryStore();
    await memory.add("User's favorite language is TypeScript");
    await memory.add("User is building an agent SDK called kenpachi-sdk");

    const results = await memory.search("agent SDK");
    console.log(results);
}

main();