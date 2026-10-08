import { addHiddenClass } from './review-handoff-class-merge';
import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';
import { tagAttributes } from './review-handoff-tag-attributes';

function declarationHides(property: string, value: string): boolean {
  // CSS-wide keywords match ASCII case-insensitively, so `NONE`
  // hides exactly like `none`.
  const normalized = value
    .replace(/!important\s*$/i, '')
    .trim()
    .toLowerCase();
  if (property === 'display') return normalized === 'none';
  if (property === 'visibility') {
    return normalized === 'hidden' || normalized === 'collapse';
  }
  if (property === 'opacity') {
    // Number('') is 0, so an empty opacity must not count as hiding.
    return normalized !== '' && Number(normalized) === 0;
  }
  return false;
}

function hasHidingInlineStyle(tag: string): boolean {
  for (const { name, value } of tagAttributes(tag)) {
    if (name !== 'style') continue;
    for (const declaration of value.split(';')) {
      const separator = declaration.indexOf(':');
      if (separator === -1) continue;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      if (declarationHides(property, declaration.slice(separator + 1))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Rewrite visibility-hiding inline styles to hiding classes before
 * the sanitizer strips the unsupported style attribute. Converted
 * markup flows through the uniform strip, readability, and variance
 * machinery exactly like a pasted `hidden` class.
 */
export function convertHiddenInlineStyles(html: string): string {
  return html.replace(HTML_TAG_PATTERN, (tag, closing) => {
    if (closing) return tag;
    if (!hasHidingInlineStyle(tag)) return tag;
    return addHiddenClass(tag);
  });
}
