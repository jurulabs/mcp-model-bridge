import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { confinePath, createWorkspaceTools } from './workspace-tools.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'bridge-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'alpha.ts'), 'export const alpha = 1;\nconst hidden = 2;\n');
  await writeFile(join(root, 'src', 'beta.ts'), 'export const beta = alpha + 1;\n');
  await writeFile(join(root, 'notes.md'), 'nothing to see\n');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('confinePath', () => {
  it('accepts a path inside the workspace', () => {
    expect(confinePath(root, 'src/alpha.ts')).toBe(join(root, 'src', 'alpha.ts'));
  });

  it('rejects traversal above the workspace root', () => {
    expect(() => confinePath(root, '../../etc/passwd')).toThrow(/outside the workspace/i);
  });

  it('rejects an absolute path pointing elsewhere', () => {
    expect(() => confinePath(root, 'C:\\Windows\\System32\\drivers\\etc\\hosts')).toThrow(
      /outside the workspace/i,
    );
  });

  it('rejects traversal disguised by an inner segment', () => {
    expect(() => confinePath(root, 'src/../../escape.txt')).toThrow(/outside the workspace/i);
  });
});

describe('createWorkspaceTools', () => {
  it('exposes exactly read_file and grep_search', () => {
    const names = createWorkspaceTools(root).map((tool) => tool.name);

    expect(names).toEqual(['read_file', 'grep_search']);
  });

  it('reads a file inside the workspace', async () => {
    const tools = createWorkspaceTools(root);
    const readFileTool = tools.find((tool) => tool.name === 'read_file');

    const output = await readFileTool?.run({ path: 'src/alpha.ts' });

    expect(output).toContain('export const alpha');
  });

  it('reports a helpful message for a missing file', async () => {
    const readFileTool = createWorkspaceTools(root)[0];

    await expect(readFileTool?.run({ path: 'src/ghost.ts' })).resolves.toMatch(/not found/i);
  });

  it('finds matches across files with grep_search', async () => {
    const grepTool = createWorkspaceTools(root)[1];

    const output = await grepTool?.run({ pattern: 'alpha' });

    expect(output).toContain('alpha.ts');
    expect(output).toContain('beta.ts');
  });

  it('reports no matches plainly', async () => {
    const grepTool = createWorkspaceTools(root)[1];

    await expect(grepTool?.run({ pattern: 'zzz-absent' })).resolves.toMatch(/no matches/i);
  });

  it('rejects a read outside the workspace', async () => {
    const readFileTool = createWorkspaceTools(root)[0];

    await expect(readFileTool?.run({ path: '../escape.txt' })).resolves.toMatch(/outside/i);
  });

  it('requires a path argument for read_file', async () => {
    const readFileTool = createWorkspaceTools(root)[0];

    await expect(readFileTool?.run({})).resolves.toMatch(/path/i);
  });
});

