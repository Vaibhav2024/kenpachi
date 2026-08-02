// examples/7-streaming.ts
import { Agent } from "../src/index.js";
import { createScriptedStreamingProvider, textTurn } from "../tests/fakes.js";

async function main() {
    // Option 1: full event stream
    const streamProvider = createScriptedStreamingProvider([textTurn("This answer arrives token by token.")]);
    const streamAgent = new Agent(streamProvider, []);

    process.stdout.write("Agent (stream): ");
    for await (const event of streamAgent.stream("Tell me something")) {
        if (event.type === "text_delta") process.stdout.write(event.text);
    }
    process.stdout.write("\n");

    // Option 2: simpler — onText shorthand on run()
    const runProvider = createScriptedStreamingProvider([textTurn("Same text, simpler API.")]);
    const runAgent = new Agent(runProvider, []);

    process.stdout.write("Agent (onText): ");
    await runAgent.run("Tell me something", {
        onText: (chunk) => process.stdout.write(chunk),
    });
    process.stdout.write("\n");
}

main();
