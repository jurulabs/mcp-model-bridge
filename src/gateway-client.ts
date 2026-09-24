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
  readonly authScheme?: GatewayAuthScheme;
  readonly maxTokens?: number;
}

/** How the gateway expects the credential to be presented. */
export type GatewayAuthScheme = 'x-api-key' | 'bearer';

const AUTH_SCHEMES: readonly GatewayAuthScheme[] = ['x-api-key', 'bearer'];
const DEFAULT_AUTH_SCHEME: GatewayAuthScheme = 'x-api-key';

/**
 * Reads the configured auth scheme, refusing anything unrecognised.
 *
 * Anthropic expects `x-api-key`; most corporate gateways sit behind an OAuth
 * proxy and expect `Authorization: Bearer`. Guessing wrong produces a 401 that
 * looks like a bad token, so the choice is explicit and a typo fails loudly.
 */
export function parseAuthScheme(value: string | undefined): GatewayAuthScheme {
  const normalised = value?.trim().toLowerCase() ?? '';
  if (normalised.length === 0) {
    return DEFAULT_AUTH_SCHEME;
  }

  const match = AUTH_SCHEMES.find((scheme) => scheme === normalised);
  if (!match) {
    throw new Error(
      `Unknown gateway auth scheme "${value}". Use one of: ${AUTH_SCHEMES.join(', ')}.`,
    );
  }

  return match;
}

function buildHeaders(options: HttpGatewayOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };

  if ((options.authScheme ?? DEFAULT_AUTH_SCHEME) === 'bearer') {
    headers['authorization'] = `Bearer ${options.token}`;
  } else {
    headers['x-api-key'] = options.token;
  }

  return headers;
}

/**
 * Anthropic-style Messages client.
 *
 * The gateway schema is isolated here so swapping providers is a one-file
 * change rather than a change across the loop.
 */
export function createHttpGateway(options: HttpGatewayOptions): GatewayClient {
  return {
    complete: async (request: GatewayRequest): Promise<GatewayReply> => {
      const response = await fetch(`${options.baseUrl.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        headers: buildHeaders(options),
        body: JSON.stringify({
          model: request.model,
          max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
          system: buildSystemPrompt(request),
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Gateway returned ${response.status}: ${detail.slice(0, 400)}`);
      }

      const text = extractText(await response.json());
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



