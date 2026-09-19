import { describe, expect, it } from 'vitest';
import { parseAgentDefinition } from './agent-loader.js';

const EXPLORER = `---
name: Explorer
description: Read-only codebase exploration. Locates code across many files.
argument-hint: Describe what to locate
x-github-copilot-invoke-policy: ["model", "user"]
tools: ['read_file', 'list_dir', 'grep_search']
---

## Mission

Locate code and report where it lives.
`;

describe('parseAgentDefinition', () => {
  it('reads the name from frontmatter', () => {
    const agent = parseAgentDefinition(EXPLORER);

    expect(agent.name).toBe('Explorer');
  });

  it('reads the description from frontmatter', () => {
    const agent = parseAgentDefinition(EXPLORER);

    expect(agent.description).toBe(
      'Read-only codebase exploration. Locates code across many files.',
    );
  });

  it('parses the tools list into individual entries', () => {
    const agent = parseAgentDefinition(EXPLORER);

    expect(agent.declaredTools).toEqual(['read_file', 'list_dir', 'grep_search']);
  });

  it('uses the body after frontmatter as the system prompt', () => {
    const agent = parseAgentDefinition(EXPLORER);

    expect(agent.systemPrompt).toContain('## Mission');
    expect(agent.systemPrompt).not.toContain('argument-hint');
  });

  it('parses double-quoted tool entries', () => {
    const source = '---\nname: A\ntools: ["read_file"]\n---\nBody';

    expect(parseAgentDefinition(source).declaredTools).toEqual(['read_file']);
  });

  it('returns an empty tools list when the field is absent', () => {
    const source = '---\nname: A\n---\nBody';

    expect(parseAgentDefinition(source).declaredTools).toEqual([]);
  });

  it('defaults description to an empty string when absent', () => {
    const source = '---\nname: A\n---\nBody';

    expect(parseAgentDefinition(source).description).toBe('');
  });

  it('rejects a file without frontmatter', () => {
    expect(() => parseAgentDefinition('# Just a heading')).toThrow(/frontmatter/i);
  });

  it('rejects frontmatter without a name', () => {
    expect(() => parseAgentDefinition('---\ndescription: x\n---\nBody')).toThrow(/name/i);
  });

  it('rejects an empty body', () => {
    expect(() => parseAgentDefinition('---\nname: A\n---\n   \n')).toThrow(/body/i);
  });

  it('tolerates carriage returns in line endings', () => {
    const source = '---\r\nname: A\r\ntools: ["read_file"]\r\n---\r\nBody text\r\n';
    const agent = parseAgentDefinition(source);

    expect(agent.name).toBe('A');
    expect(agent.declaredTools).toEqual(['read_file']);
  });
});

