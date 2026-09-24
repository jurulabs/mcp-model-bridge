import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { ModelPolicy } from './model-resolver.js';
import { stripBom } from './text.js';

const MODEL_POLICY_SCHEMA = z.object({
  tiers: z.record(z.string(), z.string()).default({}),
  allowedModels: z.array(z.string()).default([]),
});

type ReadText = (path: string) => Promise<string>;

const readFromDisk: ReadText = (path) => readFile(path, 'utf8');

/**
 * Reads and validates the model policy.
 *
 * Each failure mode gets its own message. A missing file, malformed JSON and a
 * wrong shape are three different mistakes with three different fixes, and
 * collapsing them into one error sends the operator looking in the wrong place.
 */
export async function loadModelPolicy(
  path: string,
  readText: ReadText = readFromDisk,
): Promise<ModelPolicy> {
  let source: string;
  try {
    source = await readText(path);
  } catch {
    throw new Error(
      `Model policy not readable at ${path}. ` +
        'Set BRIDGE_MODEL_POLICY, or add .github/model-policy.json to the project.',
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(source));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Model policy at ${path} is not valid JSON: ${reason}`);
  }

  const parsed = MODEL_POLICY_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Model policy at ${path} is invalid: ${parsed.error.message}`);
  }

  return parsed.data;
}

