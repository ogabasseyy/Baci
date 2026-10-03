import { describe, expect, it } from 'vitest';
import {
  type TierContractSource,
  type TierContractTier,
  tierContractIssues,
} from './merchant-image-variant-pilot-tiers';

const CURRENT = 'pilot-r2-current';
const FROZEN_R1 = 'pilot-r1-frozen';
const SOURCE: TierContractSource = {
  bytes: 5000,
  format: 'avif',
  orientedHeight: 600,
  orientedWidth: 800,
  sha256: 'b'.repeat(64),
};

function tier(overrides: Partial<TierContractTier> = {}): TierContractTier {
  return {
    bytes: 1096,
    delivery: 'generated',
    format: 'avif',
    height: 72,
    requestedWidth: 96,
    sha256: 'a'.repeat(64),
    width: 96,
    ...overrides,
  };
}

describe('tierContractIssues', () => {
  it('accepts capped generated tiers at the encoded geometry', () => {
    expect(tierContractIssues(tier(), SOURCE, CURRENT, CURRENT)).toEqual([]);
    // Byte-equality boundary: equal is not larger.
    expect(
      tierContractIssues(tier({ bytes: 5000 }), SOURCE, CURRENT, CURRENT)
    ).toEqual([]);
  });

  it('rejects omitted delivery only for the current recipe', () => {
    expect(
      tierContractIssues(
        tier({ delivery: undefined }),
        SOURCE,
        CURRENT,
        CURRENT
      )
    ).toEqual(['tier "96:avif" omits delivery for the current recipe']);
    expect(
      tierContractIssues(
        tier({ delivery: undefined }),
        SOURCE,
        FROZEN_R1,
        CURRENT
      )
    ).toEqual([]);
  });

  it('caps generated tiers at source bytes', () => {
    expect(
      tierContractIssues(tier({ bytes: 5001 }), SOURCE, CURRENT, CURRENT)
    ).toEqual([
      'tier "96:avif" claims generated delivery above the source bytes',
    ]);
  });

  it('requires the over-source exception to actually hold', () => {
    const over = (overrides: Partial<TierContractTier>) =>
      tier({
        bytes: 6000,
        delivery: 'generated-over-source',
        format: 'webp',
        ...overrides,
      });
    expect(tierContractIssues(over({}), SOURCE, CURRENT, CURRENT)).toEqual([]);
    expect(
      tierContractIssues(over({ bytes: 4000 }), SOURCE, CURRENT, CURRENT)
    ).toEqual([
      'tier "96:webp" claims an over-source limitation that does not hold',
    ]);
    expect(
      tierContractIssues(over({ format: 'avif' }), SOURCE, CURRENT, CURRENT)
    ).toEqual([
      'tier "96:avif" claims an over-source limitation that does not hold',
    ]);
  });

  it('binds pass-through tiers to the source exactly', () => {
    const pass = (overrides: Partial<TierContractTier>) =>
      tier({
        bytes: SOURCE.bytes,
        delivery: 'original-passthrough',
        format: 'avif',
        height: 600,
        sha256: SOURCE.sha256,
        width: 800,
        ...overrides,
      });
    expect(tierContractIssues(pass({}), SOURCE, CURRENT, CURRENT)).toEqual([]);
    expect(
      tierContractIssues(pass({ bytes: 4999 }), SOURCE, CURRENT, CURRENT)
    ).toEqual([
      'tier "96:avif" pass-through must reuse the validated source bytes, dimensions, and codec',
    ]);
  });

  it('binds encoded geometry to the source ladder', () => {
    expect(
      tierContractIssues(tier({ width: 900 }), SOURCE, CURRENT, CURRENT)
    ).toEqual(['tier "96:avif" width 900 is not the encoded rung width 96']);
    expect(
      tierContractIssues(tier({ width: 48 }), SOURCE, CURRENT, CURRENT)
    ).toEqual(['tier "96:avif" width 48 is not the encoded rung width 96']);
    expect(
      tierContractIssues(tier({ height: 80 }), SOURCE, CURRENT, CURRENT)
    ).toEqual([
      'tier "96:avif" height 80 breaks the source aspect ratio (expected 72±1)',
    ]);
    // ±1px encoder tolerance at the boundary.
    expect(
      tierContractIssues(tier({ height: 73 }), SOURCE, CURRENT, CURRENT)
    ).toEqual([]);
    expect(
      tierContractIssues(tier({ height: 71 }), SOURCE, CURRENT, CURRENT)
    ).toEqual([]);
  });
});
