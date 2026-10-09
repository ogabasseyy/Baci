import { parseHandoffDom } from './review-handoff-dom';

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

function hasBareDisplayUtility(element: Element): boolean {
  for (const token of element.classList) {
    if (!token.includes(':') && DISPLAY_UTILITIES.has(token)) return true;
  }
  return false;
}

function hasUntilFoundValue(element: Element): boolean {
  // hidden="until-found" renders through content-visibility rather
  // than display, so a display utility cannot expose it; only the
  // ordinary hidden state yields to a bare display class. The match
  // is ASCII case-insensitive per the enumerated-attribute rules,
  // with no trimming: padded values fall back to Hidden state.
  return element.getAttribute('hidden')?.toLowerCase() === 'until-found';
}

/**
 * Rewrite HTML-hidden elements to hiding classes before the sanitizer
 * drops the unsupported attribute. Converted markup flows through the
 * uniform strip, readability, and variance machinery exactly like a
 * pasted `hidden` class.
 */
export function convertHiddenAttributes(html: string): string {
  const doc = parseHandoffDom(html);
  for (const element of doc.querySelectorAll('[hidden]')) {
    if (hasBareDisplayUtility(element) && !hasUntilFoundValue(element)) {
      continue;
    }
    element.classList.add('hidden');
  }
  return doc.body.innerHTML;
}
