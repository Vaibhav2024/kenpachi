import { z } from "zod";
import { defineTool, type Tool } from "./tool.js";
import { runInSandbox } from "./sandbox.js";

export interface Connector {
    baseUrl: string;
    authEnvVar?: string;
    description: string;
}

export class ConnectorRegistry {
    private connectors = new Map<string, Connector>();

    register(name: string, connector: Connector): void {
        this.connectors.set(name, connector);
    }

    get(name: string): Connector | undefined {
        return this.connectors.get(name);
    }

    list(): { name: string; description: string }[] {
        return [...this.connectors.entries()].map(([name, c]) => ({ name, description: c.description }));
    }

    /** Read the secret for a connector from process.env — never exposed to the model. */
    getSecret(name: string): string | undefined {
        const connector = this.connectors.get(name);
        if (!connector?.authEnvVar) return undefined;
        return process.env[connector.authEnvVar];
    }
}

// Allowed parameter types as a const array for strict Zod + TypeScript alignment
export const PARAM_KINDS = ["string", "number", "boolean"] as const;
export type ParamKind = (typeof PARAM_KINDS)[number];

export interface SynthesizedToolSpec {
    name: string;
    description: string;
    parameters: Record<string, ParamKind>;
    jsBody: string;
    connector?: string;
}

/**
 * Turn a model-authored spec into a real Tool.
 */
export function synthesizeTool(spec: SynthesizedToolSpec, registry: ConnectorRegistry): Tool {
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [key, kind] of Object.entries(spec.parameters)) {
        shape[key] = kind === "string" ? z.string() : kind === "number" ? z.number() : z.boolean();
    }

    const schema = z.object(shape);

    if (spec.connector && !registry.get(spec.connector)) {
        throw new Error(
            `Synthesized tool "${spec.name}" references unknown connector "${spec.connector}". ` +
            `Register it first with registry.register(...) — the model cannot create connectors.`
        );
    }

    return defineTool({
        name: spec.name,
        description: spec.description,
        schema,
        // Explicitly type `args` as Record<string, unknown> to prevent `any` leaks
        async execute(args: Record<string, unknown>): Promise<unknown> {
            const connector = spec.connector ? registry.get(spec.connector)! : undefined;
            const secret = spec.connector ? registry.getSecret(spec.connector) : undefined;

            return runInSandbox({
                jsBody: spec.jsBody,
                args,
                connector: connector ? { baseUrl: connector.baseUrl, secret } : undefined,
            });
        },
    });
}

// Zod Schema explicitly tied to SynthesizedToolSpec
const toolProposalSchema = z.object({
    name: z.string().regex(/^[a-z0-9_]+$/, "Name must be snake_case"),
    description: z.string(),
    parameters: z.record(z.string(), z.enum(PARAM_KINDS)),
    jsBody: z.string(),
    connector: z.string().optional(),
});

// Infer the exact TS type from the Zod schema
export type ProposedToolArgs = z.infer<typeof toolProposalSchema>;

export const proposeToolSpecTool = defineTool({
    name: "propose_tool",
    description:
        "Propose a new pure-logic helper tool (math, string/data transforms, parsing). " +
        "Cannot access the network or secrets directly — use `connector` to reference a " +
        "pre-registered connector if external data is needed.",
    schema: toolProposalSchema,
    async execute(args: ProposedToolArgs): Promise<{ proposed: true; spec: SynthesizedToolSpec }> {
        return { proposed: true, spec: args };
    },
});