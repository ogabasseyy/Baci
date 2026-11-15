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
  if (slotInstance === undefined) return config.id;
  // The id is looked up by GPT and must be a plain element id, so anything
  // outside letters, digits, "-" and "_" becomes "_". Replacing instead of
  // dropping keeps different instances different ("a/b" is not "ab"); only
  // an empty instance falls back to the placement id.
  const suffix = String(slotInstance).replace(/[^a-zA-Z0-9_-]/g, '_');
  return suffix ? `${config.id}-${suffix}` : config.id;
}
