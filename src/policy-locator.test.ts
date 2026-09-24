import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { locateModelPolicy } from './policy-locator.js';

const PACKAGE_ROOT = resolve('/opt/mcp-model-bridge');
const WORKSPACE_ROOT = resolve('/home/dev/some-other-project');
const WORKSPACE_POLICY = join(WORKSPACE_ROOT, '.github', 'model-policy.json');
const BUNDLED_POLICY = join(PACKAGE_ROOT, 'model-policy.json');

const lookup = { workspaceRoot: WORKSPACE_ROOT, packageRoot: PACKAGE_ROOT };

const nothingExists = (): boolean => false;
const everythingExists = (): boolean => true;

describe('locateModelPolicy', () => {
  it('uses an explicitly configured path above everything else', () => {
    const explicit = resolve('/etc/custom-policy.json');

    const location = locateModelPolicy({ ...lookup, explicit }, everythingExists);

    expect(location).toEqual({ path: explicit, source: 'explicit' });
  });

  it('keeps an explicit path even when the file is absent, so the error names it', () => {
    const explicit = resolve('/etc/typo.json');

    const location = locateModelPolicy({ ...lookup, explicit }, nothingExists);

    expect(location.path).toBe(explicit);
  });

  it('ignores an explicit path that is only whitespace', () => {
    const location = locateModelPolicy({ ...lookup, explicit: '   ' }, nothingExists);

    expect(location.source).toBe('bundled');
  });

  it('prefers a project-local policy when the host project ships one', () => {
    const location = locateModelPolicy(lookup, (path) => path === WORKSPACE_POLICY);

    expect(location).toEqual({ path: WORKSPACE_POLICY, source: 'workspace' });
  });

  it('falls back to the bundled policy so a fresh project needs no configuration', () => {
    const location = locateModelPolicy(lookup, nothingExists);

    expect(location).toEqual({ path: BUNDLED_POLICY, source: 'bundled' });
  });

  it('resolves the project-local policy relative to the workspace root, not the package', () => {
    const location = locateModelPolicy(lookup, everythingExists);

    expect(location.path.startsWith(WORKSPACE_ROOT)).toBe(true);
  });
});

