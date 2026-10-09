import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';
import { stripHtmlComments } from './strip-html-comments';

function hasPopoverAttribute(tag: string): boolean {
  // The popover attribute is usually valueless, and valueless
  // attributes never reach tagAttributes, so match the raw tag with
  // quoted values blanked: a title mentioning "popover" must not
  // count, while popover="manual" and bare popover both hide.
  const unquoted = tag.replace(/"[^"]*"|'[^']*'/g, '""');
  return /(?:\s|^)popover(?:\s*=\s*(?:""|[^\s>]+))?(?=[\s/>])/i.test(unquoted);
}

/**
 * Whether markup hides content in a popover. A popover element is
 * hidden until shown, and static markup cannot express the shown
 * state (there is no open attribute to preserve); the sanitizer
 * allowlist drops the popover attribute while keeping the element
 * and its children, exposing the note as permanently visible text.
 * Runs pre-sanitize, since sanitization itself removes the evidence.
 * Comments strip first: a popover opener inside comment text is not
 * markup.
 */
export function hasUnopenedPopover(html: string): boolean {
  for (const match of stripHtmlComments(html).matchAll(HTML_TAG_PATTERN)) {
    if (match[1] === '/') continue;
    if (hasPopoverAttribute(match[0])) return true;
  }
  return false;
}
