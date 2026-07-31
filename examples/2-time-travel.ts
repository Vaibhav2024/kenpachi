// examples/2-time-travel.ts
import { Agent } from "../src/index.js";
import { createScriptedProvider, textTurn } from "../tests/fakes.js";

async function main() {
    const provider = createScriptedProvider([
        textTurn("Turn 1 reply"),
        textTurn("Original path Turn 2"),
        textTurn("Branched path Turn 2")
    ]);

    const agent = new Agent(provider, []);

    // 1. Run Turn 1
    await agent.run("first message");
    const snapshotAfterTurn1 = agent.context.listSnapshots().at(-1)!;

    // 2. Branch off from Turn 1
    const branchedContext = agent.context.branchAt(snapshotAfterTurn1.turnIndex);

    // 3. Continue the ORIGINAL path
    await agent.run("continue down path A");

    // 4. Run a NEW path using the BRANCHED context
    const branchedAgent = new Agent(provider, [], branchedContext);
    await branchedAgent.run("try alternative path B");

    console.log("Original History Length:", agent.context.getMessages().length); // 4 messages
    console.log("Branched History Length:", branchedAgent.context.getMessages().length); // 4 messages
    
    console.log("\nOriginal Path Last Message:", agent.context.getMessages().at(-1));
    console.log("Branched Path Last Message:", branchedAgent.context.getMessages().at(-1));
}

main();