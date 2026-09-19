import { describe, expect, it, vi } from 'vitest';
import { runBoundedAgent } from './agent-loop.js';
import type { AgentDefinition, GatewayClient, WorkspaceTool } from './types.js';

const AGENT: AgentDefinition = {
  name: 'Explorer',
  description: 'finds things',
  declaredTools: ['read_file', 'grep_search'],
  systemPrompt: 'Locate code and report where it lives.',
};

function toolStub(name: string, output = 'tool output'): WorkspaceTool {
  return { name, describe: name, run: vi.fn().mockResolvedValue(output) };
}

function gatewayReturning(...replies: Array<{ text: string; toolCalls?: unknown[] }>): GatewayClient {
  const queue = [...replies];
  return {
    complete: vi.fn().mockImplementation(async () => {
      const next = queue.shift() ?? { text: 'done', toolCalls: [] };
      return { text: next.text, toolCalls: next.toolCalls ?? [] };
    }),
  };
}

describe('runBoundedAgent', () => {
  it('returns the model it actually used', async () => {
    const result = await runBoundedAgent({
      agent: AGENT,
      model: { id: 'gpt-5.6-luna', tier: 'cheap' },
      task: 'find X',
      gateway: gatewayReturning({ text: 'final answer' }),
      tools: [],
      maxRounds: 3,
    });

    expect(result.modelUsed).toBe('gpt-5.6-luna');
    expect(result.tierRequested).toBe('cheap');
  });

  it('finishes in one round when no tool is requested', async () => {
    const result = await runBoundedAgent({
      agent: AGENT,
      model: { id: 'm', tier: 'cheap' },
      task: 'find X',
      gateway: gatewayReturning({ text: 'final answer' }),
      tools: [],
      maxRounds: 5,
    });

    expect(result.roundsUsed).toBe(1);
    expect(result.stoppedReason).toBe('completed');
    expect(result.output).toBe('final answer');
  });

  it('executes a requested tool and feeds the result back', async () => {
    const grep = toolStub('grep_search', 'src/a.ts:1: match');
    const gateway = gatewayReturning(
      { text: 'searching', toolCalls: [{ tool: 'grep_search', input: { pattern: 'x' } }] },
      { text: 'found it' },
    );

    const result = await runBoundedAgent({
      agent: AGENT,
      model: { id: 'm', tier: 'cheap' },
      task: 'find X',
      gateway,
      tools: [grep],
      maxRounds: 5,
    });

    expect(grep.run).toHaveBeenCalledWith({ pattern: 'x' });
    expect(result.toolCallsMade).toBe(1);
    expect(result.output).toBe('found it');
  });

  it('stops at the round ceiling', async () => {
    const gateway = gatewayReturning(
      ...Array.from({ length: 10 }, () => ({
        text: 'again',
        toolCalls: [{ tool: 'grep_search', input: {} }],
      })),
    );

    const result = await runBoundedAgent({
      agent: AGENT,
      model: { id: 'm', tier: 'cheap' },
      task: 'loop forever',
      gateway,
      tools: [toolStub('grep_search')],
      maxRounds: 3,
    });

    expect(result.roundsUsed).toBe(3);
    expect(result.stoppedReason).toBe('round-limit');
  });

  it('reports an unknown tool back to the model instead of failing', async () => {
    const gateway = gatewayReturning(
      { text: 'try', toolCalls: [{ tool: 'delete_everything', input: {} }] },
      { text: 'recovered' },
    );

    const result = await runBoundedAgent({
      agent: AGENT,
      model: { id: 'm', tier: 'cheap' },
      task: 'x',
      gateway,
      tools: [toolStub('grep_search')],
      maxRounds: 4,
    });

    expect(result.output).toBe('recovered');
    expect(result.stoppedReason).toBe('completed');
  });

  it('turns a throwing tool into text rather than aborting the run', async () => {
    const exploding: WorkspaceTool = {
      name: 'grep_search',
      describe: 'x',
      run: vi.fn().mockRejectedValue(new Error('disk on fire')),
    };
    const gateway = gatewayReturning(
      { text: 'try', toolCalls: [{ tool: 'grep_search', input: {} }] },
      { text: 'handled' },
    );

    const result = await runBoundedAgent({
      agent: AGENT,
      model: { id: 'm', tier: 'cheap' },
      task: 'x',
      gateway,
      tools: [exploding],
      maxRounds: 4,
    });

    expect(result.output).toBe('handled');
  });

  it('passes only the offered tool names to the gateway', async () => {
    const gateway = gatewayReturning({ text: 'done' });

    await runBoundedAgent({
      agent: AGENT,
      model: { id: 'm', tier: 'cheap' },
      task: 'x',
      gateway,
      tools: [toolStub('read_file'), toolStub('grep_search')],
      maxRounds: 2,
    });

    expect(gateway.complete).toHaveBeenCalledWith(
      expect.objectContaining({ toolNames: ['read_file', 'grep_search'] }),
    );
  });

  it('rejects a non-positive round ceiling', async () => {
    await expect(
      runBoundedAgent({
        agent: AGENT,
        model: { id: 'm', tier: 'cheap' },
        task: 'x',
        gateway: gatewayReturning({ text: 'done' }),
        tools: [],
        maxRounds: 0,
      }),
    ).rejects.toThrow(/at least 1/i);
  });

  it('strips tool protocol blocks from the returned output', async () => {
    const gateway = gatewayReturning(
      ...Array.from({ length: 5 }, () => ({
        text: 'still working\n```tool\n{"tool":"grep_search","input":{}}\n```',
        toolCalls: [{ tool: 'grep_search', input: {} }],
      })),
    );

    const result = await runBoundedAgent({
      agent: AGENT,
      model: { id: 'm', tier: 'cheap' },
      task: 'x',
      gateway,
      tools: [toolStub('grep_search')],
      maxRounds: 2,
    });

    expect(result.stoppedReason).toBe('round-limit');
    expect(result.output).toBe('still working');
  });
});


