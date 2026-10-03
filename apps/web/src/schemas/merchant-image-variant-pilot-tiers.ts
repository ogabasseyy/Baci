// Pure per-tier manifest-contract checks for the merchant image variant
// pilot. Extracted from schemas/merchant-image-variant-pilot.ts (300-line
// rule); behavior is identical. No native imports here, mirroring the
// schema module. Message strings stay in lockstep with the generator
// reference (infra/cdn-transformer/pilot/manifest.mjs) and the preflight
// mirror — the shared contract-fixtures corpus breaks loudly on drift.

export interface TierContractTier {
  bytes: number;
  delivery?:
    | 'generated'
    | 'generated-over-source'
    | 'original-passthrough'
    | undefined;
  format: string;
  height: number;
  requestedWidth: number;
  sha256: string;
  width: number;
}

export interface TierContractSource {
  bytes: number;
  format: string;
  orientedHeight: number;
  orientedWidth: number;
  sha256: string;
}

// Per-disposition invariants hold only where a disposition is recorded;
// legacy tiers without one are exempt (frozen r1 keeps its meaning).
// 'generated' is capped at source bytes; 'generated-over-source' must
// exceed them (the exception must actually hold).
export function tierContractIssues(
  tier: TierContractTier,
  source: TierContractSource,
  recipeId: string,
  currentRecipeId: string
): string[] {
  const issues: string[] = [];
  const key = `${tier.requestedWidth}:${tier.format}`;
  if (tier.delivery === undefined) {
    // Delivery-less tiers are frozen r1 legacy. A current-recipe
    // manifest that omits delivery would skip every never-larger
    // check and activate unguarded, so the omission is rejected.
    if (recipeId === currentRecipeId) {
      issues.push(`tier "${key}" omits delivery for the current recipe`);
    }
    return issues;
  }
  if (tier.delivery === 'generated' && tier.bytes > source.bytes) {
    issues.push(
      `tier "${key}" claims generated delivery above the source bytes`
    );
  }
  if (
    tier.delivery === 'generated-over-source' &&
    (tier.bytes <= source.bytes || tier.format === source.format)
  ) {
    issues.push(
      `tier "${key}" claims an over-source limitation that does not hold`
    );
  }
  if (tier.delivery === 'original-passthrough') {
    const matchesSource =
      tier.bytes === source.bytes &&
      tier.sha256 === source.sha256 &&
      tier.width === source.orientedWidth &&
      tier.height === source.orientedHeight &&
      tier.format === source.format;
    if (!matchesSource) {
      issues.push(
        `tier "${key}" pass-through must reuse the validated source bytes, dimensions, and codec`
      );
    }
  }
  if (
    tier.delivery === 'generated' ||
    tier.delivery === 'generated-over-source'
  ) {
    // Encoded tiers bind to the source ladder: no upscaling past the
    // source, no narrowed/1px claims, aspect preserved within the same
    // ±1px height tolerance the encoder verifies its own output with.
    // (Pass-through tiers are exempt: they carry source dimensions,
    // bound exactly by the check above.)
    const encodedWidth = Math.min(tier.requestedWidth, source.orientedWidth);
    if (tier.width !== encodedWidth) {
      issues.push(
        `tier "${key}" width ${tier.width} is not the encoded rung width ${encodedWidth}`
      );
    } else {
      const idealHeight = Math.round(
        (source.orientedHeight * tier.width) / source.orientedWidth
      );
      if (Math.abs(tier.height - idealHeight) > 1) {
        issues.push(
          `tier "${key}" height ${tier.height} breaks the source aspect ratio (expected ${idealHeight}±1)`
        );
      }
    }
  }
  return issues;
}
