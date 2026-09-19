import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { WorkspaceTool } from './types.js';

const MAX_FILE_CHARS = 20_000;
const MAX_MATCHES = 60;
const MAX_SCANNED_FILES = 800;
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', '.idea', 'coverage']);
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.md', '.yml', '.yaml', '.toml', '.prisma', '.css', '.html', '.txt',
]);

/**
 * Resolves a caller-supplied path against the workspace root and refuses
 * anything that escapes it. A cheap model driving these tools is untrusted
 * input, so confinement is the boundary that keeps it harmless.
 */
export function confinePath(workspaceRoot: string, requested: string): string {
  const root = resolve(workspaceRoot);
  const target = isAbsolute(requested) ? resolve(requested) : resolve(root, requested);
  const difference = relative(root, target);

  const escapes = difference.startsWith('..') || isAbsolute(difference);
  if (escapes) {
    throw new Error(`Path "${requested}" resolves outside the workspace root`);
  }

  return target;
}

/** Builds the read-only toolset the bounded loop offers to the model. */
export function createWorkspaceTools(workspaceRoot: string): readonly WorkspaceTool[] {
  return [
    {
      name: 'read_file',
      describe: 'Read a UTF-8 text file. Input: { "path": "relative/path.ts" }',
      run: async (input) => readFileTool(workspaceRoot, input),
    },
    {
      name: 'grep_search',
      describe: 'Search file contents. Input: { "pattern": "text or regex" }',
      run: async (input) => grepSearchTool(workspaceRoot, input),
    },
  ];
}

async function readFileTool(
  workspaceRoot: string,
  input: Record<string, unknown>,
): Promise<string> {
  const requested = asText(input['path']);
  if (!requested) {
    return 'Error: read_file requires a "path" argument.';
  }

  let target: string;
  try {
    target = confinePath(workspaceRoot, requested);
  } catch {
    return `Error: "${requested}" is outside the workspace root and was refused.`;
  }

  try {
    const content = await readFile(target, 'utf8');
    return truncate(content, MAX_FILE_CHARS);
  } catch {
    return `Error: file not found or unreadable: ${requested}`;
  }
}

async function grepSearchTool(
  workspaceRoot: string,
  input: Record<string, unknown>,
): Promise<string> {
  const pattern = asText(input['pattern']);
  if (!pattern) {
    return 'Error: grep_search requires a "pattern" argument.';
  }

  let matcher: RegExp;
  try {
    matcher = new RegExp(pattern, 'i');
  } catch {
    return `Error: "${pattern}" is not a valid regular expression.`;
  }

  const root = resolve(workspaceRoot);
  const files = await collectTextFiles(root, root, []);
  const hits: string[] = [];

  for (const file of files) {
    if (hits.length >= MAX_MATCHES) {
      break;
    }

    let content: string;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue;
    }

    content.split(/\r?\n/).forEach((line, index) => {
      if (hits.length < MAX_MATCHES && matcher.test(line)) {
        const location = relative(root, file).split(sep).join('/');
        hits.push(`${location}:${index + 1}: ${line.trim().slice(0, 200)}`);
      }
    });
  }

  return hits.length > 0 ? hits.join('\n') : `No matches for "${pattern}".`;
}

async function collectTextFiles(
  root: string,
  directory: string,
  accumulated: string[],
): Promise<string[]> {
  if (accumulated.length >= MAX_SCANNED_FILES) {
    return accumulated;
  }

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return accumulated;
  }

  for (const entry of entries) {
    if (accumulated.length >= MAX_SCANNED_FILES) {
      break;
    }

    const full = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        await collectTextFiles(root, full, accumulated);
      }
      continue;
    }

    if (hasTextExtension(entry.name)) {
      accumulated.push(full);
    }
  }

  return accumulated;
}

function hasTextExtension(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 && TEXT_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function truncate(content: string, limit: number): string {
  return content.length <= limit
    ? content
    : `${content.slice(0, limit)}\n… truncated at ${limit} characters …`;
}



