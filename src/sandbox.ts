import vm from "node:vm";

export interface SandboxConnectorConfig {
    baseUrl: string;
    secret?: string;
}

export interface RunInSandboxOptions {
    jsBody: string;
    args: Record<string, unknown>;
    connector?: SandboxConnectorConfig;
    timeoutMs?: number
}

/**
 * Executes a small, untrusted JS function body in an isolated V8 context.
 * No `require`, no `process`, no filesystem. If a connector is provided, the
 * sandbox gets a `callConnector(path, init)` function that appends the auth
 * header server-side — the secret string itself is never bound into the
 * sandbox's scope.
 */

export async function runInSandbox(opts: RunInSandboxOptions): Promise<unknown> {
    const { jsBody, args, connector, timeoutMs = 2000 } = opts;

    const sandbox: Record<string, unknown> = {
        args,
        __result: undefined,
        __error: undefined
    }

    if (connector) {
        sandbox.callConnector = async (path: string, init: RequestInit = {}) => {
            const headers = new Headers(init.headers);
            if (connector.secret) headers.set("authorization", `Bearer ${connector.secret}`);
            const res = await fetch(new URL(path, connector.baseUrl), { ...init, headers });
            if (!res.ok) throw new Error(`Connector call failed: ${res.status} ${res.statusText}`);
            return res.json();
        }
    }


    const context = vm.createContext(sandbox, {
        codeGeneration: { strings: false, wasm: false },
    });

    const wrapped = `
    (async () => {
        try {
            __result = await (async (args) => {
            ${jsBody}
            })(args);
        } catch (e) {
            __error = e instanceof Error ? e.message : String(e);
        }
        })();
    `;

    const script = new vm.Script(wrapped, { filename: "synthesized-tool.js" });
    script.runInContext(context, { timeout: timeoutMs });

    // vm's runInContext doesn't await the async IIFE; poll the sandbox object.
    // Fine for short pure-logic bodies (the stated use case for this feature).
    const deadline = Date.now() + timeoutMs;
    while (sandbox.__result === undefined && sandbox.__error === undefined) {
        if (Date.now() > deadline) throw new Error("Sandbox execution timed out");
        await new Promise((r) => setTimeout(r, 5));
    }

    if (sandbox.__error) throw new Error(String(sandbox.__error));
    return sandbox.__result;
}
