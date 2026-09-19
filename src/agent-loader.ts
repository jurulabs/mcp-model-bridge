import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentDefinition } from './types.js';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
const LIST_ENTRY_PATTERN = /['"]([^'"]+)['"]/g;

/**
 * Splits a `.agent.md` file into its frontmatter fields and its body.
 *
 * The body becomes the system prompt verbatim, which keeps one file as the
 * single source of truth for both the native agent and this bridge.
 */
export function parseAgentDefinition(source: string): AgentDefinition {
  const match = FRONTMATTER_PATTERN.exec(source);
  if (!match) {
    throw new Error('Agent file is missing YAML frontmatter delimited by ---');
  }

  const [, frontmatter = '', body = ''] = match;
  const fields = parseFields(frontmatter);

  const name = fields.get('name');
  if (!name) {
    throw new Error('Agent frontmatter is missing the required field: name');
  }

  const systemPrompt = body.trim();
  if (systemPrompt.length === 0) {
    throw new Error(`Agent "${name}" has an empty body, so it carries no system prompt`);
  }

  return {
    name,
    description: fields.get('description') ?? '',
    declaredTools: parseList(fields.get('tools')),
    systemPrompt,
  };
}

/** Reads and parses an agent definition by its file stem. */
export async function loadAgentDefinition(
  agentsDirectory: string,
  agentName: string,
): Promise<AgentDefinition> {
  const path = join(agentsDirectory, `${agentName}.agent.md`);

  try {
    return parseAgentDefinition(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissingFile(error)) {
      throw new Error(`Unknown agent "${agentName}": no definition at ${path}`);
    }
    throw error;
  }
}

function parseFields(frontmatter: string): Map<string, string> {
  const fields = new Map<string, string>();

  for (const line of frontmatter.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key.length > 0) {
      fields.set(key, value);
    }
  }

  return fields;
}

function parseList(raw: string | undefined): readonly string[] {
  if (!raw) {
    return [];
  }

  return [...raw.matchAll(LIST_ENTRY_PATTERN)].map((entry) => entry[1] ?? '');
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}

