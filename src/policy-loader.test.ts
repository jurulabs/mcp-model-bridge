import { describe, expect, it } from 'vitest';
import { loadModelPolicy } from './policy-loader.js';

const VALID = JSON.stringify({
  tiers: { cheap: 'small-model' },
  allowedModels: ['small-model'],
});

const reading = (content: string) => async (): Promise<string> => content;
const failing = async (): Promise<string> => {
  throw new Error('ENOENT');
};

describe('loadModelPolicy', () => {
  it('parses a well formed policy', async () => {
    const policy = await loadModelPolicy('/p.json', reading(VALID));

    expect(policy).toEqual({ tiers: { cheap: 'small-model' }, allowedModels: ['small-model'] });
  });

  it('accepts a file saved with a UTF-8 byte order mark', async () => {
    const policy = await loadModelPolicy('/p.json', reading(`\uFEFF${VALID}`));

    expect(policy.allowedModels).toEqual(['small-model']);
  });

  it('defaults both fields when the file is an empty object', async () => {
    const policy = await loadModelPolicy('/p.json', reading('{}'));

    expect(policy).toEqual({ tiers: {}, allowedModels: [] });
  });

  it('names the path when the file cannot be read', async () => {
    await expect(loadModelPolicy('/missing.json', failing)).rejects.toThrow('/missing.json');
  });

  it('points at the configuration options when the file cannot be read', async () => {
    await expect(loadModelPolicy('/missing.json', failing)).rejects.toThrow(
      /BRIDGE_MODEL_POLICY/,
    );
  });

  it('reports invalid JSON as such, not as a schema problem', async () => {
    await expect(loadModelPolicy('/p.json', reading('{ oops'))).rejects.toThrow(/not valid JSON/);
  });

  it('rejects a policy whose tiers are not strings', async () => {
    const wrongShape = JSON.stringify({ tiers: { cheap: 42 }, allowedModels: [] });

    await expect(loadModelPolicy('/p.json', reading(wrongShape))).rejects.toThrow(/is invalid/);
  });

  it('rejects a policy that is not an object at all', async () => {
    await expect(loadModelPolicy('/p.json', reading('"just a string"'))).rejects.toThrow(
      /is invalid/,
    );
  });
});

