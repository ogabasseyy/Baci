import type { ApprovedPilotTier, PilotLabIndex } from './lab-index';

export function indexKey(input: {
  assetId: string;
  merchantId: string;
  role: string;
  sourceSha256: string;
}): string {
  return `${input.merchantId}/${input.assetId}/${input.sourceSha256}/${input.role}`;
}

export function lookupPilotTiers(
  index: PilotLabIndex,
  key: {
    assetId: string;
    merchantId: string;
    role: string;
    sourceSha256: string;
  }
): readonly ApprovedPilotTier[] | null {
  return index.entries[indexKey(key)] ?? null;
}

export function selectPilotTier(
  tiers: readonly ApprovedPilotTier[],
  request: { format: 'avif' | 'webp'; requestedWidth: number }
): ApprovedPilotTier | null {
  const adequate = tiers
    .filter(
      (tier) =>
        tier.format === request.format && tier.width >= request.requestedWidth
    )
    .sort((left, right) => left.width - right.width);
  return adequate[0] ?? null;
}
