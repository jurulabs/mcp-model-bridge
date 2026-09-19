import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadAgentDefinition } from './agent-loader.js';
import { runBoundedAgent } from './agent-loop.js';
import { createHttpGateway, createMockGateway } from './gateway-client.js';
import { resolveModel } from './model-resolver.js';
import type { ModelPolicy } from './model-resolver.js';
import { createWorkspaceTools } from './workspace-tools.js';
import type { GatewayClient } from './types.js';

const DEFAULT_MAX_ROUNDS = 4;
const ROUND_CEILING = 10;
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MODEL_POLICY_SCHEMA = z.object({
  tiers: z.record(z.string(), z.string()).default({}),
  allowedModels: z.array(z.string()).default([]),
});

async function main(): Promise<void> {
  const workspaceRoot = resolve(process.env['BRIDGE_WORKSPACE_ROOT'] ?? process.cwd());
  const agentsDirectory = resolve(
    process.env['BRIDGE_AGENTS_DIR'] ?? resolve(workspaceRoot, '.github/agents'),
  );
  const policyPath = resolve(
    process.env['BRIDGE_MODEL_POLICY'] ?? resolve(PACKAGE_ROOT, 'model-policy.json'),
  );
  const policy = await loadPolicy(policyPath);
  const gatewayMode = resolveGatewayMode();
  const gateway = createGateway(gatewayMode);

  const server = new McpServer({ name: 'model-bridge', version: '0.0.1' });

  server.registerTool(
    'run_agent',
    {
      title: 'Run an agent on a chosen model',
      description:
        'Executes an agent definition from .github/agents against a model you name. ' +
        'Returns the result plus the model actually used, so routing is verifiable.',
      inputSchema: {
        agent: z.string().describe('File stem under .github/agents, e.g. "Explorer"'),
        task: z.string().describe('The instruction, including the desired output contract'),
        model: z
          .string()
          .optional()
          .describe('Tier name (cheap, default, strong) or an allow-listed model id'),
        maxRounds: z
          .number()
          .int()
          .min(1)
          .max(ROUND_CEILING)
          .optional()
          .describe(`Tool rounds before stopping (default ${DEFAULT_MAX_ROUNDS})`),
      },
    },
    async ({ agent, task, model, maxRounds }) => {
      try {
        const definition = await loadAgentDefinition(agentsDirectory, agent);
        const resolved = resolveModel(policy, model);
        const result = await runBoundedAgent({
          agent: definition,
          model: resolved,
          task,
          gateway,
          tools: createWorkspaceTools(workspaceRoot),
          maxRounds: maxRounds ?? DEFAULT_MAX_ROUNDS,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                result.output,
                '',
                '---',
                `agent: ${definition.name}`,
                `model used: ${result.modelUsed} (tier: ${result.tierRequested})`,
                `rounds: ${result.roundsUsed}, tool calls: ${result.toolCallsMade}`,
                `stopped: ${result.stoppedReason}`,
              ].join('\n'),
            },
          ],
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `run_agent failed: ${reason}` }],
        };
      }
    },
  );

  server.registerTool(
    'list_agents',
    {
      title: 'List bridgeable agents',
      description: 'Shows which agent definitions the bridge can execute, and the model tiers.',
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: [
            `agents directory: ${agentsDirectory}`,
            `tiers: ${Object.entries(policy.tiers)
              .map(([tier, id]) => `${tier} -> ${id}`)
              .join(', ')}`,
            `allowed models: ${policy.allowedModels.join(', ')}`,
            `gateway: ${gatewayMode.kind}`,
          ].join('\n'),
        },
      ],
    }),
  );

  await server.connect(new StdioServerTransport());
}

async function loadPolicy(path: string): Promise<ModelPolicy> {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  const parsed = MODEL_POLICY_SCHEMA.safeParse(raw);

  if (!parsed.success) {
    throw new Error(`Model policy at ${path} is invalid: ${parsed.error.message}`);
  }

  return parsed.data;
}

type GatewayMode =
  | { readonly kind: 'http'; readonly baseUrl: string; readonly token: string }
  | { readonly kind: 'mock' };

/**
 * Decides the gateway once, so the reported mode and the client in use can
 * never disagree. A half-configured gateway reports "mock", which surfaces the
 * missing variable instead of hiding it behind a confident label.
 */
function resolveGatewayMode(): GatewayMode {
  const baseUrl = process.env['BRIDGE_GATEWAY_URL'];
  const token = process.env['BRIDGE_GATEWAY_TOKEN'];

  return baseUrl && token ? { kind: 'http', baseUrl, token } : { kind: 'mock' };
}

function createGateway(mode: GatewayMode): GatewayClient {
  return mode.kind === 'http'
    ? createHttpGateway({ baseUrl: mode.baseUrl, token: mode.token })
    : createMockGateway();
}

main().catch((error: unknown) => {
  process.stderr.write(`model-bridge failed to start: ${String(error)}\n`);
  process.exit(1);
});


