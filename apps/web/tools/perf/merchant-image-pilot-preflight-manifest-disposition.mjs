// Per-disposition manifest invariants (extracted from
// merchant-image-pilot-preflight-manifest.mjs): recipe ceilings,
// delivery omission, never-larger guards, pass-through identity,
// and encoded-ladder geometry. Returns the issue list.
import {
  BUDGETS,
  RECIPE_ID,
} from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import { isPlainObject } from './merchant-image-pilot-preflight-shared.mjs';

export function tierDispositionIssues(tiers, { manifest, role, source }) {
  const issues = [];
  if (!isPlainObject(source)) {
    return issues;
  }
  // Per-disposition invariants hold only where a disposition is recorded;
  // legacy tiers without one are exempt (frozen r1 keeps its meaning).
  // 'generated' is capped at source bytes; 'generated-over-source' must
  // exceed them (the exception must actually hold).
  for (const tier of tiers) {
    if (!isPlainObject(tier)) {
      continue;
    }
    const key = `${tier.requestedWidth}:${tier.format}`;
    // Recipe byte ceilings bind every encoded tier — including frozen r1
    // legacy and over-source (the exception records bytes above the
    // SOURCE, still within the rung budget). Only pass-through reuses
    // source bytes outside the ladder budgets. Malformed tiers already
    // flagged above are skipped instead of double-reported.
    if (
      tier.delivery !== 'original-passthrough' &&
      typeof tier.bytes === 'number' &&
      typeof tier.requestedWidth === 'number' &&
      typeof tier.format === 'string' &&
      typeof role === 'string'
    ) {
      const ceiling = BUDGETS[role]?.[tier.requestedWidth]?.[tier.format];
      if (ceiling === undefined) {
        issues.push(`tier "${key}" has no recipe ceiling for role "${role}"`);
      } else if (tier.bytes > ceiling) {
        issues.push(
          `tier "${key}" exceeds the recipe byte ceiling (${tier.bytes} > ${ceiling})`
        );
      }
    }
    if (tier.delivery === undefined) {
      // Delivery-less tiers are frozen r1 legacy. A current-recipe
      // manifest that omits delivery would skip every never-larger
      // check and activate unguarded, so the omission is rejected.
      // (Keyed on the true current recipe, not the caller's effective
      // recipe parameter used by the currency rule above.)
      if (manifest.recipeId === RECIPE_ID) {
        issues.push(`tier "${key}" omits delivery for the current recipe`);
      }
      continue;
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
      (tier.delivery === 'generated' ||
        tier.delivery === 'generated-over-source') &&
      // Unlike the Zod mirrors (whose refinements only run on valid
      // shapes), this loop also sees malformed tiers already flagged
      // above — skip the arithmetic there instead of reporting NaN.
      typeof tier.width === 'number' &&
      typeof tier.requestedWidth === 'number' &&
      typeof tier.height === 'number' &&
      typeof source.orientedWidth === 'number' &&
      typeof source.orientedHeight === 'number'
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
  }
  return issues;
}
