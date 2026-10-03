import { describe, expect, it } from 'vitest';
import type { ApprovedPilotTier } from './lab-index';
import { buildPilotSrcSet, pilotTierUrl } from './responsive-projection';

function tier(
  overrides: Partial<ApprovedPilotTier> & { width: number }
): ApprovedPilotTier {
  return {
    actualWidth: overrides.width,
    bytes: 1000,
    contentType: 'image/webp',
    delivery: 'generated',
    fileName: `${'a'.repeat(64)}.webp`,
    format: 'webp',
    generationId: 'c'.repeat(64),
    height: Math.round((overrides.width * 3) / 4),
    quality: 70,
    requestedWidth: overrides.width,
    sha256: 'a'.repeat(64),
    ...overrides,
  };
}

describe('pilotTierUrl', () => {
  it('builds explicit format URLs without transform params', () => {
    const url = pilotTierUrl({
      baseUrl: '/__pilot',
      tier: tier({ width: 96 }),
    });
    expect(url).toBe(`/__pilot/${'c'.repeat(64)}/${'a'.repeat(64)}.webp`);
    expect(url).not.toMatch(/[?&](w|q)=/);
  });
});

describe('buildPilotSrcSet', () => {
  it('emits width descriptors equal to encoded widths', () => {
    const tiers = [
      tier({ fileName: 'f96.webp', sha256: 'b'.repeat(64), width: 96 }),
      tier({ fileName: 'f384.webp', sha256: 'd'.repeat(64), width: 384 }),
      tier({ fileName: 'f192.webp', sha256: 'c'.repeat(64), width: 192 }),
    ];
    const srcSet = buildPilotSrcSet({
      baseUrl: '/__pilot',
      format: 'webp',
      tiers,
    });
    const entries = srcSet.split(', ');
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatch(/ 96w$/);
    expect(entries[1]).toMatch(/ 192w$/);
    expect(entries[2]).toMatch(/ 384w$/);
  });

  it('deduplicates shared files and filters formats', () => {
    const shared = tier({
      fileName: 'shared.webp',
      sha256: 'e'.repeat(64),
      width: 48,
    });
    const tiers = [
      { ...shared, requestedWidth: 96 },
      { ...shared, requestedWidth: 192 },
      { ...shared, requestedWidth: 384 },
      tier({
        fileName: 'f48.avif',
        format: 'avif',
        sha256: 'f'.repeat(64),
        width: 48,
      }),
    ];
    expect(
      buildPilotSrcSet({ baseUrl: '/__pilot', format: 'webp', tiers }).split(
        ', '
      )
    ).toHaveLength(1);
    expect(
      buildPilotSrcSet({ baseUrl: '/__pilot', format: 'avif', tiers })
    ).toMatch(/ 48w$/);
  });

  it('returns an empty string when no tier matches', () => {
    expect(
      buildPilotSrcSet({ baseUrl: '/__pilot', format: 'avif', tiers: [] })
    ).toBe('');
    expect(
      buildPilotSrcSet({
        baseUrl: '/__pilot',
        format: 'avif',
        tiers: [tier({ width: 96 })],
      })
    ).toBe('');
  });
});
