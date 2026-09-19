import { describe, expect, it } from 'vitest';
import { resolveModel } from './model-resolver.js';
import type { ModelPolicy } from './model-resolver.js';

const POLICY: ModelPolicy = {
  tiers: {
    cheap: 'gpt-5.6-luna',
    default: 'claude-sonnet-5',
    strong: 'claude-opus-5',
  },
  allowedModels: ['gpt-5.6-luna', 'claude-sonnet-5', 'claude-opus-5'],
};

describe('resolveModel', () => {
  it('resolves a tier name to its configured model id', () => {
    expect(resolveModel(POLICY, 'cheap')).toEqual({ id: 'gpt-5.6-luna', tier: 'cheap' });
  });

  it('accepts an explicit model id that is on the allow-list', () => {
    expect(resolveModel(POLICY, 'claude-opus-5')).toEqual({
      id: 'claude-opus-5',
      tier: 'explicit',
    });
  });

  it('falls back to the default tier when no model is requested', () => {
    expect(resolveModel(POLICY, undefined)).toEqual({
      id: 'claude-sonnet-5',
      tier: 'default',
    });
  });

  it('rejects a model that is absent from the allow-list', () => {
    expect(() => resolveModel(POLICY, 'gpt-6-astra')).toThrow(/not allowed/i);
  });

  it('names the permitted values when rejecting', () => {
    expect(() => resolveModel(POLICY, 'nonsense')).toThrow(/cheap/);
  });

  it('rejects a tier that maps to a model outside the allow-list', () => {
    const broken: ModelPolicy = {
      tiers: { cheap: 'ghost-model' },
      allowedModels: ['claude-sonnet-5'],
    };

    expect(() => resolveModel(broken, 'cheap')).toThrow(/allow-list/i);
  });

  it('rejects when no default tier exists and nothing was requested', () => {
    const broken: ModelPolicy = { tiers: {}, allowedModels: [] };

    expect(() => resolveModel(broken, undefined)).toThrow(/default/i);
  });

  it('treats an empty string as no request', () => {
    expect(resolveModel(POLICY, '  ').tier).toBe('default');
  });
});

