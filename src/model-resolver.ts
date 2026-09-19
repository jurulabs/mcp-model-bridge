import type { ResolvedModel } from './types.js';

const DEFAULT_TIER = 'default';
const EXPLICIT_TIER = 'explicit';

/** Tier names mapped to concrete model ids, plus the set the bridge may call. */
export interface ModelPolicy {
  readonly tiers: Readonly<Record<string, string>>;
  readonly allowedModels: readonly string[];
}

/**
 * Turns a requested tier name or model id into a concrete model.
 *
 * Rejects anything outside the allow-list rather than falling back, because a
 * silent fallback to an expensive model spends money without anyone noticing.
 */
export function resolveModel(policy: ModelPolicy, requested: string | undefined): ResolvedModel {
  const wanted = requested?.trim() ?? '';

  if (wanted.length === 0) {
    return resolveTier(policy, DEFAULT_TIER, 'No model requested and no default tier configured');
  }

  if (wanted in policy.tiers) {
    return resolveTier(policy, wanted, `Tier "${wanted}" is not configured`);
  }

  if (policy.allowedModels.includes(wanted)) {
    return { id: wanted, tier: EXPLICIT_TIER };
  }

  throw new Error(
    `Model "${wanted}" is not allowed. Permitted values: ${describePermitted(policy)}`,
  );
}

function resolveTier(policy: ModelPolicy, tier: string, missingMessage: string): ResolvedModel {
  const id = policy.tiers[tier];
  if (!id) {
    throw new Error(`${missingMessage}. Permitted values: ${describePermitted(policy)}`);
  }

  if (!policy.allowedModels.includes(id)) {
    throw new Error(
      `Tier "${tier}" maps to "${id}", which is absent from the allow-list. Fix the policy file.`,
    );
  }

  return { id, tier };
}

function describePermitted(policy: ModelPolicy): string {
  const tiers = Object.keys(policy.tiers);
  const entries = [...tiers, ...policy.allowedModels];

  return entries.length > 0 ? entries.join(', ') : '(policy is empty)';
}

