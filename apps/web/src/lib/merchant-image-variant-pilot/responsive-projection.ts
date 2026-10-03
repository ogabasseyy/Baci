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
  const seen = new Set<string>();
  return input.tiers
    .filter((tier) => tier.format === input.format)
    .sort((left, right) => left.width - right.width)
    .filter((tier) => {
      if (seen.has(tier.fileName)) {
        return false;
      }
      seen.add(tier.fileName);
      return true;
    })
    .map(
      (tier) =>
        `${pilotTierUrl({ baseUrl: input.baseUrl, tier })} ${tier.width}w`
    )
    .join(', ');
}
