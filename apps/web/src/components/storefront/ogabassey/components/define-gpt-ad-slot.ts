import type { AdPlacement } from '../config/ads';

type GptCreativeSize = [number, number];

function resolveViewportSizes(
  configuredSizes: ReadonlyArray<readonly [number, number]> | undefined,
  fallbackWidth: number,
  fallbackHeight: number
): GptCreativeSize | GptCreativeSize[] {
  if (!configuredSizes || configuredSizes.length === 0) {
    return [fallbackWidth, fallbackHeight];
  }
  if (configuredSizes.length === 1) {
    return [configuredSizes[0][0], configuredSizes[0][1]];
  }
  return configuredSizes.map(([w, h]): GptCreativeSize => [w, h]);
}

/**
 * Defines the GPT slot for a placement, registering multi-size desktop/mobile
 * mappings when configured so standard AdSense demand pools (728x90, 300x250,
 * 320x100, 320x50) compete inside the same height-locked `AdSlotShell`.
 * Returns null when GPT refuses the definition (for example a duplicate id).
 */
export function defineGptAdSlot(
  googletag: typeof window.googletag,
  slotPath: string,
  id: string,
  {
    width,
    height,
    mobileWidth,
    mobileHeight,
    desktopSizes,
    mobileSizes,
  }: AdPlacement
): googletag.Slot | null {
  const desktopSizeArg = resolveViewportSizes(desktopSizes, width, height);
  const slot = googletag.defineSlot(slotPath, desktopSizeArg, id);
  if (!slot) return null;
  if ((mobileWidth && mobileHeight) || desktopSizes || mobileSizes) {
    const mobileSizeArg = resolveViewportSizes(
      mobileSizes,
      mobileWidth || width,
      mobileHeight || height
    );
    const mapping = googletag
      .sizeMapping()
      .addSize([768, 0], desktopSizeArg) // Desktop
      .addSize([0, 0], mobileSizeArg) // Mobile
      .build();
    slot.defineSizeMapping(mapping);
  }
  return slot.addService(googletag.pubads());
}
