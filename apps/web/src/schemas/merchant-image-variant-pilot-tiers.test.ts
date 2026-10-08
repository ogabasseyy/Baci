import { describe, expect, it } from 'vitest';
import {
  type TierContractSource,
  type TierContractTier,
  tierContractIssues,
} from './merchant-image-variant-pilot-tiers';

const CURRENT = 'pilot-r2-current';
const FROZEN_R1 = 'pilot-r1-frozen';
const ROLE = 'logo';
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
    height: 144,
    requestedWidth: 192,
    sha256: 'a'.repeat(64),
    width: 192,
    ...overrides,
  };
}

function issuesOf(
  overrides: Partial<TierContractTier> = {},
  recipeId: string = CURRENT
): string[] {
  return tierContractIssues(tier(overrides), SOURCE, recipeId, CURRENT, ROLE);
}

describe('tierContractIssues', () => {
  it('accepts capped generated tiers at the encoded geometry', () => {
    expect(issuesOf()).toEqual([]);
    // Byte-equality boundary: equal is not larger.
    expect(issuesOf({ bytes: 5000 })).toEqual([]);
  });

  it('rejects omitted delivery only for the current recipe', () => {
    expect(issuesOf({ delivery: undefined })).toEqual([
      'tier "192:avif" omits delivery for the current recipe',
    ]);
    expect(issuesOf({ delivery: undefined }, FROZEN_R1)).toEqual([]);
  });

  it('caps generated tiers at source bytes', () => {
    expect(issuesOf({ bytes: 5001 })).toEqual([
      'tier "192:avif" claims generated delivery above the source bytes',
    ]);
  });

  it('enforces the recipe byte ceiling on every encoded tier', () => {
    // logo/192/avif ceiling is 12000 (checked before disposition, so an
    // over-budget generated tier reports the ceiling first).
    expect(issuesOf({ bytes: 12001 })).toEqual([
      'tier "192:avif" exceeds the recipe byte ceiling (12001 > 12000)',
      'tier "192:avif" claims generated delivery above the source bytes',
    ]);
    // Frozen r1 legacy keeps disposition exemption but not budget exemption.
    expect(issuesOf({ bytes: 12001, delivery: undefined }, FROZEN_R1)).toEqual([
      'tier "192:avif" exceeds the recipe byte ceiling (12001 > 12000)',
    ]);
    // Over-source stays within the rung budget too: the exception records
    // bytes above the SOURCE, not above the ceiling.
    expect(
      issuesOf({
        bytes: 12000,
        delivery: 'generated-over-source',
        format: 'webp',
      })
    ).toEqual([]);
    expect(
      issuesOf({
        bytes: 12001,
        delivery: 'generated-over-source',
        format: 'webp',
      })
    ).toEqual([
      'tier "192:webp" exceeds the recipe byte ceiling (12001 > 12000)',
    ]);
    // Pass-through reuses source bytes outside the ladder budgets.
    expect(
      issuesOf({
        bytes: SOURCE.bytes,
        delivery: 'original-passthrough',
        height: 600,
        sha256: SOURCE.sha256,
        width: 800,
      })
    ).toEqual([]);
    // Unknown rungs fail closed instead of skipping the budget.
    expect(
      tierContractIssues(
        tier({ requestedWidth: 999 }),
        SOURCE,
        CURRENT,
        CURRENT,
        ROLE
      )
    ).toContain('tier "999:avif" has no recipe ceiling for role "logo"');
  });

  it('requires the over-source exception to actually hold', () => {
    const over = (overrides: Partial<TierContractTier>) =>
      tier({
        bytes: 6000,
        delivery: 'generated-over-source',
        format: 'webp',
        ...overrides,
      });
    expect(
      tierContractIssues(over({}), SOURCE, CURRENT, CURRENT, ROLE)
    ).toEqual([]);
    expect(
      tierContractIssues(over({ bytes: 4000 }), SOURCE, CURRENT, CURRENT, ROLE)
    ).toEqual([
      'tier "192:webp" claims an over-source limitation that does not hold',
    ]);
    expect(
      tierContractIssues(
        over({ format: 'avif' }),
        SOURCE,
        CURRENT,
        CURRENT,
        ROLE
      )
    ).toEqual([
      'tier "192:avif" claims an over-source limitation that does not hold',
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
    expect(
      tierContractIssues(pass({}), SOURCE, CURRENT, CURRENT, ROLE)
    ).toEqual([]);
    expect(
      tierContractIssues(pass({ bytes: 4999 }), SOURCE, CURRENT, CURRENT, ROLE)
    ).toEqual([
      'tier "192:avif" pass-through must reuse the validated source bytes, dimensions, and codec',
    ]);
  });

  it('binds encoded geometry to the source ladder', () => {
    expect(
      tierContractIssues(tier({ width: 900 }), SOURCE, CURRENT, CURRENT, ROLE)
    ).toEqual(['tier "192:avif" width 900 is not the encoded rung width 192']);
    expect(
      tierContractIssues(tier({ width: 48 }), SOURCE, CURRENT, CURRENT, ROLE)
    ).toEqual(['tier "192:avif" width 48 is not the encoded rung width 192']);
    expect(
      tierContractIssues(tier({ height: 160 }), SOURCE, CURRENT, CURRENT, ROLE)
    ).toEqual([
      'tier "192:avif" height 160 breaks the source aspect ratio (expected 144±1)',
    ]);
    // ±1px encoder tolerance at the boundary.
    expect(
      tierContractIssues(tier({ height: 145 }), SOURCE, CURRENT, CURRENT, ROLE)
    ).toEqual([]);
    expect(
      tierContractIssues(tier({ height: 143 }), SOURCE, CURRENT, CURRENT, ROLE)
    ).toEqual([]);
  });
});
