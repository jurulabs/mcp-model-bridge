import { join, resolve } from 'node:path';

/** Where the active policy came from, so `list_agents` can report it honestly. */
export type PolicySource = 'explicit' | 'workspace' | 'bundled';

export interface PolicyLocation {
  readonly path: string;
  readonly source: PolicySource;
}

export interface PolicyLookup {
  readonly explicit?: string | undefined;
  readonly workspaceRoot: string;
  readonly packageRoot: string;
}

const PROJECT_POLICY_RELATIVE_PATH = join('.github', 'model-policy.json');
const BUNDLED_POLICY_FILE = 'model-policy.json';

/**
 * Picks the policy file for this run.
 *
 * The order is explicit, then project-local, then bundled. The bundled fallback
 * is what makes the bridge usable in a fresh repository with no setup, while
 * the project-local step keeps each repository able to name its own models.
 *
 * An explicit path is honoured even when it does not exist, so the resulting
 * failure names the path the operator actually configured instead of silently
 * substituting a different file.
 */
export function locateModelPolicy(
  lookup: PolicyLookup,
  exists: (path: string) => boolean,
): PolicyLocation {
  const explicit = lookup.explicit?.trim() ?? '';
  if (explicit.length > 0) {
    return { path: resolve(explicit), source: 'explicit' };
  }

  const projectPolicy = resolve(lookup.workspaceRoot, PROJECT_POLICY_RELATIVE_PATH);
  if (exists(projectPolicy)) {
    return { path: projectPolicy, source: 'workspace' };
  }

  return { path: resolve(lookup.packageRoot, BUNDLED_POLICY_FILE), source: 'bundled' };
}

