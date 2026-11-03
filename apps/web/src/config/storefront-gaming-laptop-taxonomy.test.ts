import { describe, expect, it } from 'vitest';
import {
  DEDICATED_GAMING_LAPTOP_TOKENS,
  EXCLUDED_GAMING_LAPTOP_SUBJECTS,
} from './storefront-gaming-laptop-taxonomy';

describe('storefront-gaming-laptop-taxonomy', () => {
  it('includes core dedicated gaming laptop families and GPUs', () => {
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('predator');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('aorus');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('nitro');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('blade');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('katana');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('alienware');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('omen');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('legion');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('rog');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('tuf');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('rtx');
    expect(DEDICATED_GAMING_LAPTOP_TOKENS).toContain('geforce');
  });

  it('contains unique tokens in both dedicated tokens and excluded subjects', () => {
    const tokenSet = new Set(DEDICATED_GAMING_LAPTOP_TOKENS);
    expect(tokenSet.size).toBe(DEDICATED_GAMING_LAPTOP_TOKENS.length);

    const subjectSet = new Set(EXCLUDED_GAMING_LAPTOP_SUBJECTS);
    expect(subjectSet.size).toBe(EXCLUDED_GAMING_LAPTOP_SUBJECTS.length);
  });
});
