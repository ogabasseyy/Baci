import { describe, expect, it } from 'vitest';
import { normalizeCompactModelTierTokens } from './normalize-compact-model-tier-tokens';

describe('normalizeCompactModelTierTokens', () => {
  it('splits compact phone tier suffixes', () => {
    expect(normalizeCompactModelTierTokens(['s24fe', 'buyer'])).toEqual([
      's24',
      'fe',
      'buyer',
    ]);
  });

  it('leaves ordinary model codes unchanged', () => {
    expect(normalizeCompactModelTierTokens(['iphone15', 'corei7'])).toEqual([
      'iphone15',
      'corei7',
    ]);
  });
});
