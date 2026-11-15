import type { AdPlacement } from '../config/ads';

/**
 * Element id for one ad slot. Repeats of a placement on the same page (for
 * example the ads inserted every few rows of a product grid) each need their
 * own id: with a shared one only the first ever requests an ad.
 */
export function resolveAdSlotId(
  config: AdPlacement | undefined,
  slotInstance?: string | number
): string | undefined {
  if (!config) return undefined;
  return slotInstance === undefined
    ? config.id
    : `${config.id}-${slotInstance}`;
}

/**
 * Defines the GPT slot for a placement, with the desktop/mobile size mapping
 * when the placement has mobile dimensions. Returns null when GPT refuses the
 * definition (for example a duplicate element id).
 */
export function defineGptAdSlot(
  googletag: typeof window.googletag,
  slotPath: string,
  id: string,
  { width, height, mobileWidth, mobileHeight }: AdPlacement
): googletag.Slot | null {
  const slot = googletag.defineSlot(slotPath, [width, height], id);
  if (!slot) return null;
  if (mobileWidth && mobileHeight) {
    const mapping = googletag
      .sizeMapping()
      .addSize([768, 0], [width, height]) // Desktop
      .addSize([0, 0], [mobileWidth, mobileHeight]) // Mobile
      .build();
    slot.defineSizeMapping(mapping);
  }
  return slot.addService(googletag.pubads());
}
