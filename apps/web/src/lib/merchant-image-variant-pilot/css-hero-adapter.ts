import { type ApprovedPilotTier, selectPilotTier } from './lab-index';
import { pilotTierUrl } from './responsive-projection';

export interface PilotCssHeroSlot {
  cover: boolean;
  overlay: boolean;
}

export interface PilotCssHeroBreakpoint {
  media: string;
  requestedWidth: number;
}

export interface ProjectedCssHero {
  breakpoints: ReadonlyArray<{
    avifUrl: string;
    height: number;
    media: string;
    webpUrl: string;
    width: number;
  }>;
  cover: boolean;
  fallbackUrl: string;
  overlay: boolean;
}

// Requested widths are precomputed by the harness from the slot's CSS box,
// crop mode, and DPR (for cover, both cropped axes). The adapter only maps
// each breakpoint to the smallest adequate approved tier.
export function projectPilotCssHero(input: {
  baseUrl: string;
  breakpoints: readonly PilotCssHeroBreakpoint[];
  slot: PilotCssHeroSlot;
  tiers: readonly ApprovedPilotTier[];
}): ProjectedCssHero | null {
  const breakpoints = [];
  for (const breakpoint of input.breakpoints) {
    const avif = selectPilotTier(input.tiers, {
      format: 'avif',
      requestedWidth: breakpoint.requestedWidth,
    });
    const webp = selectPilotTier(input.tiers, {
      format: 'webp',
      requestedWidth: breakpoint.requestedWidth,
    });
    if (!avif || !webp) {
      return null;
    }
    breakpoints.push({
      avifUrl: pilotTierUrl({ baseUrl: input.baseUrl, tier: avif }),
      height: webp.height,
      media: breakpoint.media,
      webpUrl: pilotTierUrl({ baseUrl: input.baseUrl, tier: webp }),
      width: webp.width,
    });
  }
  const fallback = [...input.tiers]
    .filter((tier) => tier.format === 'webp')
    .sort((left, right) => left.width - right.width)[0];
  if (!fallback || breakpoints.length === 0) {
    return null;
  }
  return {
    breakpoints,
    cover: input.slot.cover,
    fallbackUrl: pilotTierUrl({ baseUrl: input.baseUrl, tier: fallback }),
    overlay: input.slot.overlay,
  };
}

export function projectControlCssHero(input: {
  breakpoints: readonly PilotCssHeroBreakpoint[];
  originalUrl: string;
  slot: PilotCssHeroSlot;
}): ProjectedCssHero {
  return {
    breakpoints: input.breakpoints.map((breakpoint) => ({
      avifUrl: input.originalUrl,
      height: 0,
      media: breakpoint.media,
      webpUrl: input.originalUrl,
      width: breakpoint.requestedWidth,
    })),
    cover: input.slot.cover,
    fallbackUrl: input.originalUrl,
    overlay: input.slot.overlay,
  };
}
