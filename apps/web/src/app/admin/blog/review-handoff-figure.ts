import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';

const UNPRESERVABLE_FIGURE_TAGS = new Set(['figure', 'figcaption']);

/**
 * Whether markup uses figure structure the editor cannot round-trip.
 * The sanitizer keeps figure and figcaption, but the configured
 * Tiptap extensions define image and table nodes with no figure or
 * figcaption node — so the first body edit serializes the image and
 * caption without their association.
 */
export function hasUnpreservableFigure(html: string): boolean {
  for (const match of html.matchAll(HTML_TAG_PATTERN)) {
    if (UNPRESERVABLE_FIGURE_TAGS.has(match[2].toLowerCase())) return true;
  }
  return false;
}
