/**
 * End-to-end smoke test for the MCP model bridge.
 *
 * Spawns the built server over stdio, lists its tools, then runs the Explorer
 * agent on the cheap tier. Proves the acceptance criterion from the
 * architecture: the bridge reports the model it was told to use.
 *
 * Usage:  node scripts/smoke-test.mjs
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const workspaceRoot = resolve(packageRoot, '../..');

function heading(text) {
  process.stdout.write(`\n${'='.repeat(60)}\n${text}\n${'='.repeat(60)}\n`);
}

function textOf(result) {
  return result.content.map((block) => block.text ?? '').join('\n');
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(packageRoot, 'dist/index.js')],
  env: {
    ...process.env,
    BRIDGE_WORKSPACE_ROOT: workspaceRoot,
    BRIDGE_AGENTS_DIR: resolve(workspaceRoot, '.github/agents'),
    BRIDGE_MODEL_POLICY: resolve(packageRoot, 'model-policy.json'),
  },
});

const client = new Client({ name: 'smoke-test', version: '0.0.1' });

let failures = 0;
function check(label, condition) {
  process.stdout.write(`${condition ? 'PASS' : 'FAIL'}  ${label}\n`);
  if (!condition) {
    failures += 1;
  }
}

try {
  await client.connect(transport);

  heading('1. Tool discovery');
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  process.stdout.write(`tools: ${names.join(', ')}\n`);
  check('run_agent is exposed', names.includes('run_agent'));
  check('list_agents is exposed', names.includes('list_agents'));

  heading('2. Configuration');
  const config = textOf(await client.callTool({ name: 'list_agents', arguments: {} }));
  process.stdout.write(`${config}\n`);
  check('tiers are configured', config.includes('cheap ->'));

  heading('3. Run Explorer on the cheap tier');
  const cheap = textOf(
    await client.callTool({
      name: 'run_agent',
      arguments: { agent: 'Explorer', task: 'Locate the write queue worker.', model: 'cheap' },
    }),
  );
  process.stdout.write(`${cheap}\n`);
  check('reports the cheap model id', cheap.includes('gpt-5.6-luna'));
  check('reports the requested tier', cheap.includes('tier: cheap'));
  check('executed at least one tool call', /tool calls: [1-9]/.test(cheap));

  heading('4. Run Explorer on the strong tier');
  const strong = textOf(
    await client.callTool({
      name: 'run_agent',
      arguments: { agent: 'Explorer', task: 'Same task, stronger model.', model: 'strong' },
    }),
  );
  check('same agent reports a different model', strong.includes('claude-opus-5'));
  process.stdout.write(`model line: ${strong.split('\n').find((l) => l.startsWith('model used'))}\n`);

  heading('5. Rejections');
  const badModel = textOf(
    await client.callTool({
      name: 'run_agent',
      arguments: { agent: 'Explorer', task: 'x', model: 'gpt-6-astra' },
    }),
  );
  check('refuses a model outside the allow-list', /not allowed/i.test(badModel));

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

