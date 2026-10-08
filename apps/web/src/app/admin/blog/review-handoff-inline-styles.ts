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

// Absolute, font-relative, viewport, container, and percentage
// length units: only a zero in one of these (or unitless) hides.
// Anything else is an invalid declaration the browser ignores, so
// over-matching would strip visible text.
const ZERO_FONT_SIZE_PATTERN =
  /^(\d+(?:\.\d+)?|\.\d+)\s*(px|cm|mm|q|in|pc|pt|em|rem|ex|rex|cap|rcap|ch|rch|ic|ric|lh|rlh|vw|vh|vi|vb|vmin|vmax|cqw|cqh|cqi|cqb|cqmin|cqmax|%)?$/;

function isZeroFontSize(value: string): boolean {
  const match = ZERO_FONT_SIZE_PATTERN.exec(value);
  return match !== null && Number(match[1]) === 0;
}

const TRANSFORM_FUNCTION_PATTERN = /([a-z][a-z0-9]*)\(([^()]*)\)/g;

function parseTransformNumbers(args: string): number[] | null {
  const tokens = args.split(/[\s,]+/).filter((token) => token !== '');
  const numbers: number[] = [];
  for (const token of tokens) {
    const parsed = Number(token);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    numbers.push(parsed);
  }
  return numbers;
}

function isZeroScaleFunction(name: string, args: number[]): boolean {
  switch (name) {
    case 'scale':
      return (
        (args.length === 1 && args[0] === 0) ||
        (args.length === 2 && (args[0] === 0 || args[1] === 0))
      );
    case 'scalex':
    case 'scaley':
      return args.length === 1 && args[0] === 0;
    case 'scale3d':
      return args.length === 3 && (args[0] === 0 || args[1] === 0);
    case 'matrix':
      return (
        args.length === 6 &&
        ((args[0] === 0 && args[1] === 0) || (args[2] === 0 && args[3] === 0))
      );
    case 'matrix3d': {
      if (args.length !== 16) {
        return false;
      }
      // Column-major: the X basis is (a1, a2, a3), the Y basis
      // (a5, a6, a7). A zero basis collapses that axis.
      const xCollapsed = args[0] === 0 && args[1] === 0 && args[2] === 0;
      const yCollapsed = args[4] === 0 && args[5] === 0 && args[6] === 0;
      return xCollapsed || yCollapsed;
    }
    default:
      return false;
  }
}

function isZeroScaleTransform(value: string): boolean {
  TRANSFORM_FUNCTION_PATTERN.lastIndex = 0;
  let match = TRANSFORM_FUNCTION_PATTERN.exec(value);
  while (match !== null) {
    const args = parseTransformNumbers(match[2] ?? '');
    if (args !== null && isZeroScaleFunction(match[1] ?? '', args)) {
      return true;
    }
    match = TRANSFORM_FUNCTION_PATTERN.exec(value);
  }
  return false;
}

function isZeroScaleProperty(value: string): boolean {
  const args = parseTransformNumbers(value);
  if (args === null || args.length < 1 || args.length > 3) {
    return false;
  }
  return args[0] === 0 || (args.length >= 2 && args[1] === 0);
}

function isZeroOpacityFilter(value: string): boolean {
  // A filter list applies its functions in order and opacity values
  // multiply, so any opacity(0) zeroes the final alpha. Only opacity
  // hides: brightness(0) paints black, blur paints unfocused pixels.
  TRANSFORM_FUNCTION_PATTERN.lastIndex = 0;
  let match = TRANSFORM_FUNCTION_PATTERN.exec(value);
  while (match !== null) {
    if (match[1] === 'opacity') {
      const arg = (match[2] ?? '').trim().replace(/%$/, '');
      if (arg !== '' && Number(arg) === 0) {
        return true;
      }
    }
    match = TRANSFORM_FUNCTION_PATTERN.exec(value);
  }
  return false;
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
  // Percentages are valid opacity values (`opacity: 0%` hides).
  const opacityValue = opacity?.replace(/%$/, '') ?? '';
  if (opacityValue !== '' && Number(opacityValue) === 0) {
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
  // Zero font size hides glyphs the same glyph-only way.
  const fontSize = finals.get('font-size');
  if (fontSize !== undefined && isZeroFontSize(fontSize)) {
    return 'text-transparent';
  }
  // Zero-scale transforms collapse the whole box including replaced
  // content, so they map to hidden rather than text-transparent.
  const transform = finals.get('transform');
  if (transform !== undefined && transform !== 'none') {
    if (isZeroScaleTransform(transform)) {
      return 'hidden';
    }
  }
  const scale = finals.get('scale');
  if (scale !== undefined && scale !== 'none') {
    if (isZeroScaleProperty(scale)) {
      return 'hidden';
    }
  }
  // A zeroed filter opacity makes the whole box transparent including
  // replaced content, so it maps to hidden rather than text-transparent.
  const filter = finals.get('filter');
  if (filter !== undefined && filter !== 'none') {
    if (isZeroOpacityFilter(filter)) {
      return 'hidden';
    }
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
