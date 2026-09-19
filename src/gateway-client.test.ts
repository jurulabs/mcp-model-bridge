import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpGateway, createMockGateway, parseToolCalls } from './gateway-client.js';

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
});


