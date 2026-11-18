import type { AdPlacement } from '../config/ads';

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
