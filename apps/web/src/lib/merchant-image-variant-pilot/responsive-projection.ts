import type { ApprovedPilotTier } from './lab-index';

export function pilotTierUrl(input: {
  baseUrl: string;
  tier: Pick<ApprovedPilotTier, 'fileName' | 'generationId'>;
}): string {
  return `${input.baseUrl}/${input.tier.generationId}/${input.tier.fileName}`;
}

export function buildPilotSrcSet(input: {
  baseUrl: string;
  format: 'avif' | 'webp';
  tiers: readonly ApprovedPilotTier[];
}): string {
  // Coalesce by width descriptor, not filename: after original-
  // passthrough rewrites widths to the true source width, two rungs can
  // emit the same width with different URLs, and duplicate width
  // descriptors leave srcset selection unspecified across browsers.
  // Smallest hash-verified file wins each width (passthrough source
  // bytes lose to tighter encodes at the same display width).
  const seenWidths = new Set<number>();
  return input.tiers
    .filter((tier) => tier.format === input.format)
    .sort((left, right) => left.width - right.width || left.bytes - right.bytes)
    .filter((tier) => {
      if (seenWidths.has(tier.width)) {
        return false;
      }
      seenWidths.add(tier.width);
      return true;
    })
    .map(
      (tier) =>
        `${pilotTierUrl({ baseUrl: input.baseUrl, tier })} ${tier.width}w`
    )
    .join(', ');
}
