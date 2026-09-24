import { readdir } from 'node:fs/promises';

const AGENT_SUFFIX = '.agent.md';

/**
 * Reduces a directory listing to the agent names `run_agent` accepts.
 *
 * Kept separate from the filesystem call so the naming rule is testable on its
 * own, which is where the edge cases live.
 */
export function selectAgentNames(fileNames: readonly string[]): readonly string[] {
  return fileNames
    .filter((name) => name.endsWith(AGENT_SUFFIX) && name.length > AGENT_SUFFIX.length)
    .map((name) => name.slice(0, -AGENT_SUFFIX.length))
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Lists the agents the host project offers.
 *
 * A missing or unreadable directory yields an empty list rather than an error,
 * because a project without agents is a legitimate state that should be
 * reported as such instead of preventing the server from answering at all.
 */
export async function listAgentNames(agentsDirectory: string): Promise<readonly string[]> {
  try {
    return selectAgentNames(await readdir(agentsDirectory));
  } catch {
    return [];
  }
}

