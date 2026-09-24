import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHttpGateway,
  createMockGateway,
  parseAuthScheme,
  parseGatewaySchema,
  parseToolCalls,
  resolveEndpoint,
} from './gateway-client.js';

const REQUEST = {
  model: 'claude-sonnet-5',
  systemPrompt: 'You are Explorer.',
  messages: [{ role: 'user' as const, content: 'find things' }],
  toolNames: ['grep_search'],
};

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

describe('parseToolCalls', () => {
  it('finds a single tool call in a fenced block', () => {
    const text = 'Looking now.\n```tool\n{"tool":"read_file","input":{"path":"a.ts"}}\n```';

    expect(parseToolCalls(text)).toEqual([{ tool: 'read_file', input: { path: 'a.ts' } }]);
  });

  it('finds several tool calls', () => {
    const text = [
      '```tool',
      '{"tool":"grep_search","input":{"pattern":"x"}}',
      '```',
      '```tool',
      '{"tool":"read_file","input":{"path":"b.ts"}}',
      '```',
    ].join('\n');

    expect(parseToolCalls(text)).toHaveLength(2);
  });

  it('returns nothing when no tool block is present', () => {
    expect(parseToolCalls('Just a final answer.')).toEqual([]);
  });

  it('skips a malformed tool block instead of throwing', () => {
    expect(parseToolCalls('```tool\nnot json\n```')).toEqual([]);
  });

  it('skips a block missing the tool field', () => {
    expect(parseToolCalls('```tool\n{"input":{}}\n```')).toEqual([]);
  });

  it('defaults input to an empty object when absent', () => {
    expect(parseToolCalls('```tool\n{"tool":"read_file"}\n```')).toEqual([
      { tool: 'read_file', input: {} },
    ]);
  });
});

describe('createMockGateway', () => {
  it('reports the model it was asked to use', async () => {
    const gateway = createMockGateway();

    const reply = await gateway.complete({
      model: 'gpt-5.6-luna',
      systemPrompt: 'You are Explorer.',
      messages: [{ role: 'user', content: 'find things' }],
      toolNames: ['read_file'],
    });

    expect(reply.text).toContain('gpt-5.6-luna');
  });

  it('requests a tool on the first round so the loop can be exercised', async () => {
    const gateway = createMockGateway();

    const reply = await gateway.complete({
      model: 'm',
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'task' }],
      toolNames: ['grep_search'],
    });

    expect(reply.toolCalls).toHaveLength(1);
    expect(reply.toolCalls[0]?.tool).toBe('grep_search');
  });

  it('stops requesting tools once results are in the history', async () => {
    const gateway = createMockGateway();

    const reply = await gateway.complete({
      model: 'm',
      systemPrompt: 's',
      messages: [
        { role: 'user', content: 'task' },
        { role: 'assistant', content: 'calling' },
        { role: 'user', content: 'tool result' },
      ],
      toolNames: ['grep_search'],
    });

    expect(reply.toolCalls).toEqual([]);
  });

  it('offers no tool call when the toolset is empty', async () => {
    const gateway = createMockGateway();

    const reply = await gateway.complete({
      model: 'm',
      systemPrompt: 's',
      messages: [{ role: 'user', content: 'task' }],
      toolNames: [],
    });

    expect(reply.toolCalls).toEqual([]);
  });
});

describe('createHttpGateway', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts text from a successful response', async () => {
    stubFetch({ ok: true, json: async () => ({ content: [{ text: 'hello ' }, { text: 'world' }] }) });

    const reply = await createHttpGateway({ baseUrl: 'https://gw', token: 't' }).complete(REQUEST);

    expect(reply.text).toBe('hello world');
  });

  it('parses tool calls out of the response text', async () => {
    stubFetch({
      ok: true,
      json: async () => ({
        content: [{ text: '```tool\n{"tool":"grep_search","input":{"pattern":"x"}}\n```' }],
      }),
    });

    const reply = await createHttpGateway({ baseUrl: 'https://gw', token: 't' }).complete(REQUEST);

    expect(reply.toolCalls).toEqual([{ tool: 'grep_search', input: { pattern: 'x' } }]);
  });

  it('throws with the status and body when the gateway rejects', async () => {
    stubFetch({ ok: false, status: 401, text: async () => 'bad token' });

    await expect(
      createHttpGateway({ baseUrl: 'https://gw', token: 't' }).complete(REQUEST),
    ).rejects.toThrow(/401.*bad token/s);
  });

  it('describes the tool protocol in the system prompt when tools exist', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [] }) });
    vi.stubGlobal('fetch', fetchSpy);

    await createHttpGateway({ baseUrl: 'https://gw/', token: 't' }).complete(REQUEST);

    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body.system).toContain('grep_search');
    expect(body.model).toBe('claude-sonnet-5');
  });

  it('leaves the system prompt untouched when no tools are offered', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [] }) });
    vi.stubGlobal('fetch', fetchSpy);

    await createHttpGateway({ baseUrl: 'https://gw', token: 't' }).complete({
      ...REQUEST,
      toolNames: [],
    });

    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body.system).toBe('You are Explorer.');
  });

  it('returns empty text when the payload has no content array', async () => {
    stubFetch({ ok: true, json: async () => ({}) });

    const reply = await createHttpGateway({ baseUrl: 'https://gw', token: 't' }).complete(REQUEST);

    expect(reply.text).toBe('');
  });

  it('sends the token as x-api-key by default', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [] }) });
    vi.stubGlobal('fetch', fetchSpy);

    await createHttpGateway({ baseUrl: 'https://gw', token: 'secret' }).complete(REQUEST);

    const headers = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('secret');
    expect(headers['authorization']).toBeUndefined();
  });

  it('sends the token as a bearer credential when asked', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [] }) });
    vi.stubGlobal('fetch', fetchSpy);

    await createHttpGateway({
      baseUrl: 'https://gw',
      token: 'secret',
      authScheme: 'bearer',
    }).complete(REQUEST);

    const headers = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer secret');
    expect(headers['x-api-key']).toBeUndefined();
  });
});

describe('parseAuthScheme', () => {
  it('defaults to x-api-key when unset', () => {
    expect(parseAuthScheme(undefined)).toBe('x-api-key');
  });

  it('accepts bearer', () => {
    expect(parseAuthScheme('bearer')).toBe('bearer');
  });

  it('ignores casing and surrounding space', () => {
    expect(parseAuthScheme('  Bearer ')).toBe('bearer');
  });

  it('refuses an unknown scheme instead of guessing', () => {
    expect(() => parseAuthScheme('basic')).toThrow(/basic/);
  });

  it('defaults to bearer for the openai-chat schema', () => {
    expect(parseAuthScheme(undefined, 'openai-chat')).toBe('bearer');
  });

  it('lets an explicit scheme override the schema default', () => {
    expect(parseAuthScheme('x-api-key', 'openai-chat')).toBe('x-api-key');
  });
});

describe('parseGatewaySchema', () => {
  it('defaults to the anthropic messages schema', () => {
    expect(parseGatewaySchema(undefined)).toBe('anthropic-messages');
  });

  it('accepts openai-chat', () => {
    expect(parseGatewaySchema('openai-chat')).toBe('openai-chat');
  });

  it('refuses an unknown schema instead of guessing', () => {
    expect(() => parseGatewaySchema('cohere')).toThrow(/cohere/);
  });
});

describe('resolveEndpoint', () => {
  it('appends the messages path for the anthropic schema', () => {
    expect(resolveEndpoint('https://api.anthropic.com', 'anthropic-messages')).toBe(
      'https://api.anthropic.com/v1/messages',
    );
  });

  it('appends the chat completions path for the openai schema', () => {
    expect(resolveEndpoint('https://openrouter.ai/api', 'openai-chat')).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    );
  });

  it('does not double the version segment when the base already carries it', () => {
    expect(resolveEndpoint('https://openrouter.ai/api/v1', 'openai-chat')).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    );
  });

  it('tolerates a trailing slash', () => {
    expect(resolveEndpoint('http://localhost:4000/v1/', 'anthropic-messages')).toBe(
      'http://localhost:4000/v1/messages',
    );
  });
});

describe('createHttpGateway on the openai-chat schema', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubOk(): ReturnType<typeof vi.fn> {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'routed answer' } }] }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    return fetchSpy;
  }

  it('reads the reply out of the first choice', async () => {
    stubOk();

    const reply = await createHttpGateway({
      baseUrl: 'https://openrouter.ai/api/v1',
      token: 't',
      schema: 'openai-chat',
    }).complete(REQUEST);

    expect(reply.text).toBe('routed answer');
  });

  it('carries the system prompt as a system message', async () => {
    const fetchSpy = stubOk();

    await createHttpGateway({
      baseUrl: 'https://openrouter.ai/api/v1',
      token: 't',
      schema: 'openai-chat',
    }).complete(REQUEST);

    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(body.messages[0]).toEqual({ role: 'system', content: expect.stringContaining('grep_search') });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'find things' });
  });

  it('authenticates with a bearer token and omits the anthropic header', async () => {
    const fetchSpy = stubOk();

    await createHttpGateway({
      baseUrl: 'https://openrouter.ai/api/v1',
      token: 'or-key',
      schema: 'openai-chat',
    }).complete(REQUEST);

    const headers = fetchSpy.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer or-key');
    expect(headers['anthropic-version']).toBeUndefined();
  });

  it('still finds tool calls in the returned text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            { message: { content: '```tool\n{"tool":"read_file","input":{"path":"a.ts"}}\n```' } },
          ],
        }),
      }),
    );

    const reply = await createHttpGateway({
      baseUrl: 'https://openrouter.ai/api/v1',
      token: 't',
      schema: 'openai-chat',
    }).complete(REQUEST);

    expect(reply.toolCalls).toEqual([{ tool: 'read_file', input: { path: 'a.ts' } }]);
  });

  it('returns empty text when the payload carries no choices', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    const reply = await createHttpGateway({
      baseUrl: 'https://openrouter.ai/api/v1',
      token: 't',
      schema: 'openai-chat',
    }).complete(REQUEST);

    expect(reply.text).toBe('');
  });
});




