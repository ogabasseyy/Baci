import { parseHandoffDom } from './review-handoff-dom';

// Descriptive SVG elements never paint: unwrapping them during
// sanitization would surface author notes as article text. Rendered
// SVG content (`text`, `foreignObject` children) is genuinely
// visible, so only the never-rendered subtrees strip.
const NON_RENDERED_SVG_SELECTOR = 'svg desc, svg title, svg metadata, svg defs';

/**
 * Remove never-rendered SVG subtrees before sanitization. The
 * sanitizer discards the disallowed SVG wrappers but keeps their
 * text — correct for painted `<text>`, but `<desc>` notes were
 * never displayed and must not publish. Parsing locates the
 * elements, so markup inside raw-text blocks never confuses it.
 */
export function stripNonRenderedSvgSubtrees(html: string): string {
  const doc = parseHandoffDom(html);
  for (const element of doc.querySelectorAll(NON_RENDERED_SVG_SELECTOR)) {
    element.remove();
  }
  return doc.body.innerHTML;
}
