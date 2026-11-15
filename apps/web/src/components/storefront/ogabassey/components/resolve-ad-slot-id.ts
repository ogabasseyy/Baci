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
  // The id is looked up by GPT and must be a plain element id. Letters, digits
  // and "-" pass through; every other character, "_" included, is written as
  // its code point between underscores ("/" becomes "_2f_"). Because a raw "_"
  // never survives, two different instances can never share an id; only an
  // empty instance falls back to the placement id.
  const suffix = String(slotInstance).replace(
    /[^a-zA-Z0-9-]/gu,
    (character) => `_${(character.codePointAt(0) ?? 0).toString(16)}_`
  );
  return suffix ? `${config.id}-${suffix}` : config.id;
}
