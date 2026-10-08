import { describe, expect, it } from 'vitest';
import type { ApprovedPilotTier, PilotLabIndex } from './lab-index';
import {
  indexKey,
  lookupPilotTiers,
  selectPilotTier,
} from './lab-index-lookup';

const KEY = {
  assetId: 'logo-1',
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  role: 'logo',
  sourceSha256: 'd'.repeat(64),
};

function tier(overrides: Partial<ApprovedPilotTier>): ApprovedPilotTier {
  return {
    actualWidth: 48,
    bytes: 100,
    contentType: 'image/webp',
    delivery: 'generated',
    fileName: 'tier.webp',
    format: 'webp',
    generationId: 'c'.repeat(64),
    height: 48,
    quality: 70,
    requestedWidth: 48,
    sha256: 'e'.repeat(64),
    width: 48,
    ...overrides,
  };
}

describe('indexKey', () => {
  it('binds the full identity so rotations miss', () => {
    const base = indexKey(KEY);
    expect(base).toContain(KEY.merchantId);
    for (const rotated of [
      { ...KEY, assetId: 'logo-2' },
      { ...KEY, merchantId: 'de968340-de02-4aa8-95f9-9d5f7d2b1f20' },
      { ...KEY, role: 'hero' },
      { ...KEY, sourceSha256: 'f'.repeat(64) },
    ]) {
      expect(indexKey(rotated)).not.toBe(base);
    }
  });
});

describe('lookupPilotTiers', () => {
  it('resolves exact identities and misses rotations', () => {
    const tiers = [tier({})];
    const index: PilotLabIndex = { entries: { [indexKey(KEY)]: tiers } };
    expect(lookupPilotTiers(index, KEY)).toBe(tiers);
    expect(lookupPilotTiers(index, { ...KEY, role: 'hero' })).toBeNull();
    expect(lookupPilotTiers({ entries: {} }, KEY)).toBeNull();
  });
});

describe('selectPilotTier', () => {
  const tiers = [
    tier({ format: 'webp', width: 48 }),
    tier({ format: 'webp', width: 96 }),
    tier({ contentType: 'image/avif', format: 'avif', width: 48 }),
  ];

  it('picks the smallest adequate tier in the requested format', () => {
    expect(
      selectPilotTier(tiers, { format: 'webp', requestedWidth: 40 })?.width
    ).toBe(48);
    expect(
      selectPilotTier(tiers, { format: 'webp', requestedWidth: 48 })?.width
    ).toBe(48);
    expect(
      selectPilotTier(tiers, { format: 'webp', requestedWidth: 49 })?.width
    ).toBe(96);
    expect(
      selectPilotTier(tiers, { format: 'avif', requestedWidth: 48 })?.format
    ).toBe('avif');
  });

  it('returns null beyond the ladder instead of upscaling', () => {
    expect(
      selectPilotTier(tiers, { format: 'webp', requestedWidth: 97 })
    ).toBeNull();
    expect(
      selectPilotTier([], { format: 'webp', requestedWidth: 40 })
    ).toBeNull();
  });
});
