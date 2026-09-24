import { describe, expect, it } from 'vitest';
import { selectAgentNames } from './agent-directory.js';

describe('selectAgentNames', () => {
  it('keeps only agent definition files', () => {
    const names = selectAgentNames(['Explorer.agent.md', 'README.md', 'notes.txt']);

    expect(names).toEqual(['Explorer']);
  });

  it('strips the .agent.md suffix so the result is usable as the agent argument', () => {
    const names = selectAgentNames(['Reviewer.agent.md']);

    expect(names).toEqual(['Reviewer']);
  });

  it('sorts names so the output is stable between runs', () => {
    const names = selectAgentNames(['Tester.agent.md', 'Explorer.agent.md', 'Reviewer.agent.md']);

    expect(names).toEqual(['Explorer', 'Reviewer', 'Tester']);
  });

  it('ignores a file that is merely markdown', () => {
    const names = selectAgentNames(['Explorer.md']);

    expect(names).toEqual([]);
  });

  it('ignores a file named only with the suffix', () => {
    const names = selectAgentNames(['.agent.md']);

    expect(names).toEqual([]);
  });

  it('returns an empty list for an empty directory', () => {
    expect(selectAgentNames([])).toEqual([]);
  });
});

