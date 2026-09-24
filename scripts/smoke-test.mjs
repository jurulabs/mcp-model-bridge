/**
 * End-to-end smoke test for the MCP model bridge.
 *
 * Runs the built server against a fixture workspace that has nothing to do with
 * the surrounding repository. A smoke test that only passes inside one monorepo
 * would prove the opposite of what this package claims, so the host project is
 * deliberately a stand-in with its own agents and its own model policy.
 *
 * Usage:  node scripts/smoke-test.mjs [pathToHostProject]
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const hostProject = resolve(process.argv[2] ?? resolve(packageRoot, 'test/fixture-workspace'));
const serverEntry = resolve(packageRoot, 'dist/index.js');

function heading(text) {
  process.stdout.write(`\n${'='.repeat(64)}\n${text}\n${'='.repeat(64)}\n`);
}

function textOf(result) {
  return result.content.map((block) => block.text ?? '').join('\n');
}

let failures = 0;
function check(label, condition) {
  process.stdout.write(`${condition ? 'PASS' : 'FAIL'}  ${label}\n`);
  if (!condition) {
    failures += 1;
  }
}

/**
 * Only BRIDGE_WORKSPACE_ROOT is set. The agents directory and the model policy
 * must be discovered from the host project, which is the behaviour that makes
 * the bridge droppable into an unfamiliar repository.
 */
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: { ...process.env, BRIDGE_WORKSPACE_ROOT: hostProject },
});

const client = new Client({ name: 'smoke-test', version: '0.1.0' });

try {
  await client.connect(transport);

  process.stdout.write(`host project: ${hostProject}\n`);

  heading('1. Tool discovery');
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  process.stdout.write(`tools: ${names.join(', ')}\n`);
  check('run_agent is exposed', names.includes('run_agent'));
  check('list_agents is exposed', names.includes('list_agents'));

  heading('2. Discovery from the host project');
  const config = textOf(await client.callTool({ name: 'list_agents', arguments: {} }));
  process.stdout.write(`${config}\n`);
  check('agents directory resolves inside the host project', config.includes(hostProject));
  check('project-local policy wins over the bundled one', config.includes('source: workspace'));
  check('host project tiers are in force', config.includes('cheap -> fixture-cheap-model'));

  heading('3. Run the host project agent on the cheap tier');
  const cheap = textOf(
    await client.callTool({
      name: 'run_agent',
      arguments: { agent: 'Scout', task: 'Locate the queue worker.', model: 'cheap' },
    }),
  );
  process.stdout.write(`${cheap}\n`);
  check('reports the cheap model id', cheap.includes('fixture-cheap-model'));
  check('reports the requested tier', cheap.includes('tier: cheap'));
  check('executed at least one tool call', /tool calls: [1-9]/.test(cheap));

  heading('4. Same agent, stronger tier');
  const strong = textOf(
    await client.callTool({
      name: 'run_agent',
      arguments: { agent: 'Scout', task: 'Same task, stronger model.', model: 'strong' },
    }),
  );
  const modelLine = strong.split('\n').find((line) => line.startsWith('model used'));
  process.stdout.write(`${modelLine}\n`);
  check('same agent reports a different model', strong.includes('fixture-strong-model'));

  heading('5. Rejections');
  const badModel = textOf(
    await client.callTool({
      name: 'run_agent',
      arguments: { agent: 'Scout', task: 'x', model: 'claude-opus-5' },
    }),
  );
  check('refuses a model outside the host allow-list', /not allowed/i.test(badModel));

  const badAgent = textOf(
    await client.callTool({
      name: 'run_agent',
      arguments: { agent: 'DoesNotExist', task: 'x', model: 'cheap' },
    }),
  );
  check('refuses an unknown agent', /unknown agent/i.test(badAgent));

  heading(failures === 0 ? 'SMOKE TEST PASSED' : `SMOKE TEST FAILED (${failures})`);
} finally {
  await client.close();
}

process.exit(failures === 0 ? 0 : 1);

