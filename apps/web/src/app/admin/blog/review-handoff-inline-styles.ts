import { isZeroAreaClipPath } from './review-handoff-clip-path';
import { parseHandoffDom } from './review-handoff-dom';

const IMPORTANT_SUFFIX_PATTERN = /!\s*important\s*$/i;

function stripCssComments(style: string): string {
  // Comments can hide anywhere outside strings — inside values
  // (`display:/*x*/none`), names, even around `!important` — so
  // strip them before declaration splitting. Quoted strings keep
  // their text (`content:"/*"` is two characters, not a comment),
  // and an unterminated comment runs to the end per CSS. Backslash
  // escapes keep a quote inside its string.
  let output = '';
  let index = 0;
  let quote: string | null = null;
  while (index < style.length) {
    const char = style[index] ?? '';
    if (quote !== null) {
      output += char;
      if (char === '\\' && index + 1 < style.length) {
        output += style[index + 1] ?? '';
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      output += char;
      index += 1;
      continue;
    }
    if (char === '/' && style[index + 1] === '*') {
      const end = style.indexOf('*/', index + 2);
      // CSS strips comments pre-tokenization (so `n/** /o/**/ne`
      // reads as `none`); dropping them outright is exactly that.
      index = end === -1 ? style.length : end + 2;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}

function isImportantDeclaration(value: string): boolean {
  // CSS allows whitespace between `!` and `important`, matched
  // ASCII case-insensitively like every other declaration keyword.
  return IMPORTANT_SUFFIX_PATTERN.test(value);
}

function normalizeDeclarationValue(value: string): string {
  // CSS-wide keywords match ASCII case-insensitively, so `NONE`
  // hides exactly like `none`.
  return value.replace(IMPORTANT_SUFFIX_PATTERN, '').trim().toLowerCase();
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

function parseTransformNumbers(
  args: string,
  allowPercent: boolean
): number[] | null {
  const tokens = args.split(/[\s,]+/).filter((token) => token !== '');
  const numbers: number[] = [];
  for (const token of tokens) {
    // Scale functions and the scale property accept percentages
    // (0% collapses like 0); matrix() takes unitless numbers only,
    // so a percentage there is an ignored declaration, not hiding.
    const text =
      allowPercent && token.endsWith('%') ? token.slice(0, -1) : token;
    if (text === '') return null;
    const parsed = Number(text);
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
    const name = match[1] ?? '';
    const args = parseTransformNumbers(
      match[2] ?? '',
      name.startsWith('scale')
    );
    if (args !== null && isZeroScaleFunction(name, args)) {
      return true;
    }
    match = TRANSFORM_FUNCTION_PATTERN.exec(value);
  }
  return false;
}

function isZeroScaleProperty(value: string): boolean {
  const args = parseTransformNumbers(value, true);
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
      // Out-of-range values clamp to [0,1], so negatives hide.
      if (arg !== '' && Number(arg) <= 0) {
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
  // Importance beats order per property, mirroring the CSS
  // cascade: `display:none!important;display:block` hides, while
  // `display:none;display:block` shows and a later important
  // declaration still overrides an earlier one.
  const finals = new Map<string, { important: boolean; value: string }>();
  for (const declaration of stripCssComments(style).split(';')) {
    const separator = declaration.indexOf(':');
    if (separator === -1) continue;
    const name = declaration.slice(0, separator).trim().toLowerCase();
    const raw = declaration.slice(separator + 1);
    const important = isImportantDeclaration(raw);
    const existing = finals.get(name);
    if (existing?.important && !important) continue;
    finals.set(name, { important, value: normalizeDeclarationValue(raw) });
  }
  const finalValue = (property: string): string | undefined =>
    finals.get(property)?.value;
  if (finalValue('display') === 'none') return 'hidden';
  const visibility = finalValue('visibility');
  if (visibility === 'hidden' || visibility === 'collapse') return 'hidden';
  // content-visibility:hidden skips rendering the element's contents
  // entirely; sanitization strips the style attribute, so convert it
  // like display:none before that lossy step.
  if (finalValue('content-visibility') === 'hidden') return 'hidden';
  const opacity = finalValue('opacity');
  // Number('') is 0, so an empty opacity must not count as hiding.
  // Percentages are valid opacity values (`opacity: 0%` hides), and
  // out-of-range values clamp to [0,1], so negatives hide too.
  const opacityValue = opacity?.replace(/%$/, '') ?? '';
  if (opacityValue !== '' && Number(opacityValue) <= 0) {
    return 'hidden';
  }
  // -webkit-text-fill-color paints over color for glyphs, so it
  // decides when present. Transparent color hides glyphs only, so it
  // converts to text-transparent (void elements ignore the color
  // channel) rather than hidden.
  const glyphColor =
    finalValue('-webkit-text-fill-color') ?? finalValue('color');
  if (glyphColor !== undefined && isZeroAlphaColor(glyphColor)) {
    return 'text-transparent';
  }
  // Zero font size hides glyphs the same glyph-only way.
  const fontSize = finalValue('font-size');
  if (fontSize !== undefined && isZeroFontSize(fontSize)) {
    return 'text-transparent';
  }
  // Zero-scale transforms collapse the whole box including replaced
  // content, so they map to hidden rather than text-transparent.
  const transform = finalValue('transform');
  if (transform !== undefined && transform !== 'none') {
    if (isZeroScaleTransform(transform)) {
      return 'hidden';
    }
  }
  const scale = finalValue('scale');
  if (scale !== undefined && scale !== 'none') {
    if (isZeroScaleProperty(scale)) {
      return 'hidden';
    }
  }
  // A zeroed filter opacity makes the whole box transparent including
  // replaced content, so it maps to hidden rather than text-transparent.
  const filter = finalValue('filter');
  if (filter !== undefined && filter !== 'none') {
    if (isZeroOpacityFilter(filter)) {
      return 'hidden';
    }
  }
  // A zero-area clip path paints nothing of the box including
  // replaced content, so it maps to hidden as well.
  const clipPath = finalValue('clip-path');
  if (clipPath !== undefined && clipPath !== 'none') {
    if (isZeroAreaClipPath(clipPath)) {
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
  const doc = parseHandoffDom(html);
  for (const element of doc.querySelectorAll('[style]')) {
    const utility = hidingUtilityForStyle(element.getAttribute('style') ?? '');
    if (utility !== null) element.classList.add(utility);
  }
  return doc.body.innerHTML;
}
