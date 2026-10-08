import { addHiddenClass } from './review-handoff-class-merge';
import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';
import { tagAttributes } from './review-handoff-tag-attributes';

// Bare Tailwind display utilities: author display beats the UA [hidden]
// rule at every cell, so a bare display class makes the attribute
// redundant and the classes decide alone. Prefixed display (`md:block`)
// leaves cells where the attribute still hides, so those convert.
const DISPLAY_UTILITIES = new Set([
  'block',
  'inline-block',
  'inline',
  'flex',
  'inline-flex',
  'table',
  'inline-table',
  'table-caption',
  'table-cell',
  'table-column',
  'table-column-group',
  'table-footer-group',
  'table-header-group',
  'table-row-group',
  'table-row',
  'flow-root',
  'grid',
  'inline-grid',
  'contents',
  'list-item',
  'hidden',
]);

function hasHiddenAttribute(tag: string): boolean {
  // Presence hides whatever the value: even hidden="false" and
  // hidden="until-found" keep the subtree from rendering initially.
  // Valueless attributes never reach tagAttributes, so match the raw
  // tag with quoted values blanked: aria-hidden, data-hidden, and a
  // title mentioning "hidden" must not count.
  const unquoted = tag.replace(/"[^"]*"|'[^']*'/g, '""');
  return /(?:\s|^)hidden(?:\s*=\s*(?:""|[^\s>]+))?(?=[\s/>])/i.test(unquoted);
}

function hasBareDisplayUtility(tag: string): boolean {
  for (const { name, value } of tagAttributes(tag)) {
    if (name !== 'class') continue;
    for (const token of value.split(/\s+/)) {
      if (!token.includes(':') && DISPLAY_UTILITIES.has(token)) return true;
    }
  }
  return false;
}

/**
 * Rewrite HTML-hidden elements to hiding classes before the sanitizer
 * drops the unsupported attribute. Converted markup flows through the
 * uniform strip, readability, and variance machinery exactly like a
 * pasted `hidden` class.
 */
export function convertHiddenAttributes(html: string): string {
  return html.replace(HTML_TAG_PATTERN, (tag, closing) => {
    if (closing) return tag;
    if (!hasHiddenAttribute(tag)) return tag;
    if (hasBareDisplayUtility(tag)) return tag;
    return addHiddenClass(tag);
  });
}
