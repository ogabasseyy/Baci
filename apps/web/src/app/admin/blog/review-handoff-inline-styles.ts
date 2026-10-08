import { addUtilityClass } from './review-handoff-class-merge';
import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';
import { tagAttributes } from './review-handoff-tag-attributes';

function normalizeDeclarationValue(value: string): string {
  // CSS-wide keywords match ASCII case-insensitively, so `NONE`
  // hides exactly like `none`.
  return value
    .replace(/!important\s*$/i, '')
    .trim()
    .toLowerCase();
}

function isZeroAlphaColor(value: string): boolean {
  if (value === 'transparent') return true;
  const fn = /^(?:rgba?|hsla?)\((.*)\)$/.exec(value);
  if (!fn) return false;
  const inner = fn[1].trim();
  // Comma syntax carries alpha as a fourth component; modern space
  // syntax separates it with a slash. A bare triple is opaque.
  const comma = inner.includes(',');
  const segments = comma ? inner.split(',') : inner.split('/');
  if (segments.length < (comma ? 4 : 2)) return false;
  const alpha = segments[segments.length - 1].trim();
  if (alpha.endsWith('%')) return Number(alpha.slice(0, -1)) === 0;
  return alpha !== '' && Number(alpha) === 0;
}

function hidingUtilityForStyle(
  style: string
): 'hidden' | 'text-transparent' | null {
  // The last declaration wins per property, mirroring the CSS
  // cascade: `display:none;display:block` shows.
  const finals = new Map<string, string>();
  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator === -1) continue;
    finals.set(
      declaration.slice(0, separator).trim().toLowerCase(),
      normalizeDeclarationValue(declaration.slice(separator + 1))
    );
  }
  if (finals.get('display') === 'none') return 'hidden';
  const visibility = finals.get('visibility');
  if (visibility === 'hidden' || visibility === 'collapse') return 'hidden';
  const opacity = finals.get('opacity');
  // Number('') is 0, so an empty opacity must not count as hiding.
  if (opacity !== undefined && opacity !== '' && Number(opacity) === 0) {
    return 'hidden';
  }
  // -webkit-text-fill-color paints over color for glyphs, so it
  // decides when present. Transparent color hides glyphs only, so it
  // converts to text-transparent (void elements ignore the color
  // channel) rather than hidden.
  const glyphColor =
    finals.get('-webkit-text-fill-color') ?? finals.get('color');
  if (glyphColor !== undefined && isZeroAlphaColor(glyphColor)) {
    return 'text-transparent';
  }
  return null;
}

/**
 * Rewrite visibility-hiding inline styles to hiding classes before
 * the sanitizer strips the unsupported style attribute. Converted
 * markup flows through the uniform strip, readability, and variance
 * machinery exactly like pasted hiding classes.
 */
export function convertHiddenInlineStyles(html: string): string {
  return html.replace(HTML_TAG_PATTERN, (tag, closing) => {
    if (closing) return tag;
    for (const { name, value } of tagAttributes(tag)) {
      if (name !== 'style') continue;
      const utility = hidingUtilityForStyle(value);
      if (utility !== null) return addUtilityClass(tag, utility);
    }
    return tag;
  });
}
