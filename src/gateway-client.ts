import type { GatewayClient, GatewayReply, GatewayRequest, ToolCall } from './types.js';

const TOOL_BLOCK_PATTERN = /```tool\s*\r?\n([\s\S]*?)```/g;
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Extracts tool calls the model emitted as fenced ```tool blocks.
 *
 * A text protocol keeps the bridge portable across gateways that expose
 * different native tool-calling schemas. Malformed blocks are dropped rather
 * than thrown, so one bad emission cannot abort an otherwise healthy run.
 */
export function parseToolCalls(text: string): readonly ToolCall[] {
  const calls: ToolCall[] = [];

  for (const match of text.matchAll(TOOL_BLOCK_PATTERN)) {
    const body = match[1];
    if (!body) {
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(body);
      const call = toToolCall(parsed);
      if (call) {
        calls.push(call);
      }
    } catch {
      continue;
    }
  }

  return calls;
}

/** Gateway stand-in that exercises the full loop without credentials. */
export function createMockGateway(): GatewayClient {
  return {
    complete: async (request: GatewayRequest): Promise<GatewayReply> => {
      const firstTool = request.toolNames[0];
      const isFirstRound = request.messages.length === 1;

      if (isFirstRound && firstTool) {
        return {
          text: `[mock ${request.model}] probing with ${firstTool}\n\`\`\`tool\n${JSON.stringify({
            tool: firstTool,
            input: firstTool === 'grep_search' ? { pattern: 'export' } : { path: 'package.json' },
          })}\n\`\`\``,
          toolCalls: parseToolCalls(
            `\`\`\`tool\n${JSON.stringify({
              tool: firstTool,
              input: firstTool === 'grep_search' ? { pattern: 'export' } : { path: 'package.json' },
            })}\n\`\`\``,
          ),
        };
      }

      return {
        text: [
          `[mock ${request.model}] run complete.`,
          `System prompt received: ${request.systemPrompt.length} characters.`,
          `Rounds of history: ${request.messages.length}.`,
          'Set BRIDGE_GATEWAY_URL and BRIDGE_GATEWAY_TOKEN to call a real model.',
        ].join('\n'),
        toolCalls: [],
      };
    },
  };
}

export interface HttpGatewayOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly schema?: GatewaySchema;
  readonly authScheme?: GatewayAuthScheme;
  readonly maxTokens?: number;
}

/** The request/response shape the upstream endpoint speaks. */
export type GatewaySchema = 'anthropic-messages' | 'openai-chat';

/** How the gateway expects the credential to be presented. */
export type GatewayAuthScheme = 'x-api-key' | 'bearer';

const GATEWAY_SCHEMAS: readonly GatewaySchema[] = ['anthropic-messages', 'openai-chat'];
const DEFAULT_SCHEMA: GatewaySchema = 'anthropic-messages';
const AUTH_SCHEMES: readonly GatewayAuthScheme[] = ['x-api-key', 'bearer'];

const SCHEMA_PATHS: Record<GatewaySchema, string> = {
  'anthropic-messages': '/v1/messages',
  'openai-chat': '/v1/chat/completions',
};

const SCHEMA_DEFAULT_AUTH: Record<GatewaySchema, GatewayAuthScheme> = {
  'anthropic-messages': 'x-api-key',
  'openai-chat': 'bearer',
};

/** Reads the configured upstream schema, refusing anything unrecognised. */
export function parseGatewaySchema(value: string | undefined): GatewaySchema {
  const normalised = value?.trim().toLowerCase() ?? '';
  if (normalised.length === 0) {
    return DEFAULT_SCHEMA;
  }

  const match = GATEWAY_SCHEMAS.find((schema) => schema === normalised);
  if (!match) {
    throw new Error(
      `Unknown gateway schema "${value}". Use one of: ${GATEWAY_SCHEMAS.join(', ')}.`,
    );
  }

  return match;
}

/**
 * Reads the configured auth scheme, refusing anything unrecognised.
 *
 * Anthropic expects `x-api-key`; OpenRouter and most corporate gateways expect
 * `Authorization: Bearer`. Guessing wrong produces a 401 that looks like a bad
 * token, so each schema carries the right default and a typo fails loudly.
 */
export function parseAuthScheme(
  value: string | undefined,
  schema: GatewaySchema = DEFAULT_SCHEMA,
): GatewayAuthScheme {
  const normalised = value?.trim().toLowerCase() ?? '';
  if (normalised.length === 0) {
    return SCHEMA_DEFAULT_AUTH[schema];
  }

  const match = AUTH_SCHEMES.find((scheme) => scheme === normalised);
  if (!match) {
    throw new Error(
      `Unknown gateway auth scheme "${value}". Use one of: ${AUTH_SCHEMES.join(', ')}.`,
    );
  }

  return match;
}

/**
 * Builds the request URL from a base that may or may not already carry `/v1`.
 *
 * Providers document their base URL inconsistently — Anthropic without the
 * version segment, OpenRouter with it. Normalising here means a pasted base URL
 * works either way instead of producing a 404 that looks like a wrong host.
 */
export function resolveEndpoint(baseUrl: string, schema: GatewaySchema): string {
  const root = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  return `${root}${SCHEMA_PATHS[schema]}`;
}

function buildHeaders(options: HttpGatewayOptions): Record<string, string> {
  const schema = options.schema ?? DEFAULT_SCHEMA;
  const headers: Record<string, string> = { 'content-type': 'application/json' };

  if (schema === 'anthropic-messages') {
    headers['anthropic-version'] = '2023-06-01';
  }

  const authScheme = options.authScheme ?? SCHEMA_DEFAULT_AUTH[schema];
  if (authScheme === 'bearer') {
    headers['authorization'] = `Bearer ${options.token}`;
  } else {
    headers['x-api-key'] = options.token;
  }

  return headers;
}

function buildBody(request: GatewayRequest, options: HttpGatewayOptions): string {
  const schema = options.schema ?? DEFAULT_SCHEMA;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const systemPrompt = buildSystemPrompt(request);
  const messages = request.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  if (schema === 'openai-chat') {
    return JSON.stringify({
      model: request.model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    });
  }

  return JSON.stringify({
    model: request.model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });
}

/**
 * Client for an upstream that speaks either the Anthropic Messages schema or
 * the OpenAI Chat Completions schema.
 *
 * Both schemas are isolated here so swapping providers is a one-file change
 * rather than a change across the loop.
 */
export function createHttpGateway(options: HttpGatewayOptions): GatewayClient {
  const schema = options.schema ?? DEFAULT_SCHEMA;

  return {
    complete: async (request: GatewayRequest): Promise<GatewayReply> => {
      const response = await fetch(resolveEndpoint(options.baseUrl, schema), {
        method: 'POST',
        headers: buildHeaders(options),
        body: buildBody(request, options),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Gateway returned ${response.status}: ${detail.slice(0, 400)}`);
      }

      const payload: unknown = await response.json();
      const text = schema === 'openai-chat' ? extractChoiceText(payload) : extractText(payload);
      return { text, toolCalls: parseToolCalls(text) };
    },
  };
}

function buildSystemPrompt(request: GatewayRequest): string {
  if (request.toolNames.length === 0) {
    return request.systemPrompt;
  }

  return [
    request.systemPrompt,
    '',
    '## Tools',
    '',
    `Available tools: ${request.toolNames.join(', ')}.`,
    'To call one, emit a fenced block exactly like this:',
    '',
    '```tool',
    '{"tool": "grep_search", "input": {"pattern": "example"}}',
    '```',
    '',
    'Emit your final answer as plain text with no tool block.',
  ].join('\n');
}

function extractText(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || !('content' in payload)) {
    return '';
  }

  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((block) =>
      typeof block === 'object' && block !== null && 'text' in block
        ? String((block as { text?: unknown }).text ?? '')
        : '',
    )
    .join('');
}

function extractChoiceText(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || !('choices' in payload)) {
    return '';
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return '';
  }

  const first = choices[0];
  if (typeof first !== 'object' || first === null || !('message' in first)) {
    return '';
  }

  const message = (first as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null || !('content' in message)) {
    return '';
  }

  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}

function toToolCall(parsed: unknown): ToolCall | undefined {
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }

  const candidate = parsed as { tool?: unknown; input?: unknown };
  if (typeof candidate.tool !== 'string' || candidate.tool.length === 0) {
    return undefined;
  }

  const input =
    typeof candidate.input === 'object' && candidate.input !== null
      ? (candidate.input as Record<string, unknown>)
      : {};

  return { tool: candidate.tool, input };
}



