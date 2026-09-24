#!/usr/bin/env node
/**
 * One real call against the configured gateway.
 *
 * The smoke test proves the wiring with a mock. This proves the credentials,
 * the schema and the model identifier — the three things that can only fail
 * against a live endpoint. Costs one short completion.
 *
 * Usage:
 *   node scripts/gateway-check.mjs [model]
 */
import { createHttpGateway, parseAuthScheme, parseGatewaySchema, resolveEndpoint } from '../dist/gateway-client.js';

const baseUrl = process.env.BRIDGE_GATEWAY_URL;
const token = process.env.BRIDGE_GATEWAY_TOKEN;

if (!baseUrl || !token) {
  console.error('BRIDGE_GATEWAY_URL and BRIDGE_GATEWAY_TOKEN must both be set.');
  process.exit(1);
}

const schema = parseGatewaySchema(process.env.BRIDGE_GATEWAY_SCHEMA);
const authScheme = parseAuthScheme(process.env.BRIDGE_GATEWAY_AUTH, schema);
const model = process.argv[2] ?? process.env.BRIDGE_CHECK_MODEL;

if (!model) {
  console.error('Pass a model id: node scripts/gateway-check.mjs <model-id>');
  process.exit(1);
}

console.log(`endpoint: ${resolveEndpoint(baseUrl, schema)}`);
console.log(`schema:   ${schema}`);
console.log(`auth:     ${authScheme}`);
console.log(`model:    ${model}`);
console.log('');

const gateway = createHttpGateway({ baseUrl, token, schema, authScheme });

try {
  const reply = await gateway.complete({
    model,
    systemPrompt: 'Answer in one short sentence.',
    messages: [{ role: 'user', content: 'Name the model answering this request.' }],
    toolNames: [],
  });

  console.log('--- reply ---');
  console.log(reply.text.trim() || '(empty response)');
  console.log('');
  console.log('GATEWAY CHECK PASSED');
} catch (error) {
  console.error('GATEWAY CHECK FAILED');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

