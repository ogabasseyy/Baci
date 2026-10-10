import { parseHandoffDom } from './review-handoff-dom';

/**
 * Whether markup uses figure structure the editor cannot round-trip.
 * The sanitizer keeps figure and figcaption, but the configured
 * Tiptap extensions define image and table nodes with no figure or
 * figcaption node — so the first body edit serializes the image and
 * caption without their association. Comment text and stray closes
 * are not elements and never count.
 */
export function hasUnpreservableFigure(html: string): boolean {
  return parseHandoffDom(html).querySelector('figure,figcaption') !== null;
}
