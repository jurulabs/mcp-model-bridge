import { describe, expect, it } from 'vitest';
import { createMockGateway, parseToolCalls } from './gateway-client.js';

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

