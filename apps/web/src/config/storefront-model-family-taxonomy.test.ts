import { describe, expect, it } from 'vitest';
import {
  MODEL_FAMILY_ALIAS_TOKENS,
  NUMERIC_MODEL_FAMILY_ALIAS_TOKENS,
} from './storefront-model-family-taxonomy';

describe('MODEL_FAMILY_ALIAS_TOKENS', () => {
  it('contains expected model family tokens including gaming laptop families', () => {
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('alienware')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('aorus')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('blade')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('katana')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('legion')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('nitro')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('omen')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('predator')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('rog')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('tuf')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('raider')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('stealth')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('titan')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('vector')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('crosshair')).toBe(true);
  });

  it('contains expected non-gaming hardware families', () => {
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('airpods')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('buds')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('thinkpad')).toBe(true);
    expect(MODEL_FAMILY_ALIAS_TOKENS.has('xps')).toBe(true);
  });
});

describe('NUMERIC_MODEL_FAMILY_ALIAS_TOKENS', () => {
  it('identifies model families that co-occur with numeric tiers', () => {
    expect(NUMERIC_MODEL_FAMILY_ALIAS_TOKENS.has('fire')).toBe(true);
    expect(NUMERIC_MODEL_FAMILY_ALIAS_TOKENS.has('omen')).toBe(true);
    expect(NUMERIC_MODEL_FAMILY_ALIAS_TOKENS.has('optiplex')).toBe(true);
    expect(NUMERIC_MODEL_FAMILY_ALIAS_TOKENS.has('alienware')).toBe(false);
  });
});
