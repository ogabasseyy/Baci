import type { ApprovedPilotTier } from './lab-index';
import { buildPilotSrcSet, pilotTierUrl } from './responsive-projection';

export interface PilotImageSlot {
  alt: string;
  fetchPriority?: 'high' | 'low' | 'auto';
  height: number;
  loading?: 'eager' | 'lazy';
  sizes: string;
  width: number;
}

export interface ProjectedPilotImage {
  alt: string;
  fallbackSrc: string;
  fetchPriority?: 'high' | 'low' | 'auto';
  height: number;
  loading?: 'eager' | 'lazy';
  sizes: string;
  sources: ReadonlyArray<{ format: 'avif' | 'webp'; srcSet: string }>;
  width: number;
}

export function projectPilotNextImage(input: {
  baseUrl: string;
  slot: PilotImageSlot;
  tiers: readonly ApprovedPilotTier[];
}): ProjectedPilotImage | null {
  const avif = buildPilotSrcSet({
    baseUrl: input.baseUrl,
    format: 'avif',
    tiers: input.tiers,
  });
  const webp = buildPilotSrcSet({
    baseUrl: input.baseUrl,
    format: 'webp',
    tiers: input.tiers,
  });
  if (!avif || !webp) {
    return null;
  }
  // Per-format scope (known limitation, not a defect): the fallback is the
  // smallest WebP tier, and the never-larger guard holds per rung/format.
  // For AVIF-original bindings whose WebP ladder stays larger (the
  // generated-over-source disposition), a no-AVIF browser is served a
  // larger-than-original fallback — there is no smaller same-codec
  // alternative, and the AVIF original is undecodable there. Byte-saving
  // comparisons must therefore be scoped per-format; merchant-wide
  // protection needs that limitation handled first (see PR description).
  const fallback = [...input.tiers]
    .filter((tier) => tier.format === 'webp')
    .sort((left, right) => left.width - right.width)[0];
  if (!fallback) {
    return null;
  }
  return {
    alt: input.slot.alt,
    fallbackSrc: pilotTierUrl({ baseUrl: input.baseUrl, tier: fallback }),
    fetchPriority: input.slot.fetchPriority,
    height: input.slot.height,
    loading: input.slot.loading,
    sizes: input.slot.sizes,
    sources: [
      { format: 'avif', srcSet: avif },
      { format: 'webp', srcSet: webp },
    ],
    width: input.slot.width,
  };
}

export function projectControlNextImage(input: {
  originalUrl: string;
  slot: PilotImageSlot;
}): ProjectedPilotImage {
  // No-op control: same per-format source structure as the pilot arm, but
  // every candidate serves the mounted original bytes (no format upgrade).
  return {
    alt: input.slot.alt,
    fallbackSrc: input.originalUrl,
    fetchPriority: input.slot.fetchPriority,
    height: input.slot.height,
    loading: input.slot.loading,
    sizes: input.slot.sizes,
    sources: [
      { format: 'avif', srcSet: input.originalUrl },
      { format: 'webp', srcSet: input.originalUrl },
    ],
    width: input.slot.width,
  };
}
