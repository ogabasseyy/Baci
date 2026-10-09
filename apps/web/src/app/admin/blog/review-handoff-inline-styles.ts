import { isZeroAreaClipPath } from './review-handoff-clip-path';
import { resolveCssVariableReferences } from './review-handoff-css-variables';
import { parseHandoffDom } from './review-handoff-dom';
import { inheritedCustomProperties } from './review-handoff-inherited-variables';
import { collapsesBoxToZero } from './review-handoff-scale-collapse';
import { finalDeclarationsForStyle } from './review-handoff-style-declarations';

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

const OPACITY_FUNCTION_PATTERN = /opacity\(([^()]*)\)/g;

function isZeroOpacityFilter(value: string): boolean {
  // A filter list applies its functions in order and opacity values
  // multiply, so any opacity(0) zeroes the final alpha. Only opacity
  // hides: brightness(0) paints black, blur paints unfocused pixels.
  OPACITY_FUNCTION_PATTERN.lastIndex = 0;
  let match = OPACITY_FUNCTION_PATTERN.exec(value);
  while (match !== null) {
    const arg = (match[1] ?? '').trim().replace(/%$/, '');
    // Out-of-range values clamp to [0,1], so negatives hide.
    if (arg !== '' && Number(arg) <= 0) {
      return true;
    }
    match = OPACITY_FUNCTION_PATTERN.exec(value);
  }
  return false;
}

function hidingUtilityForStyle(
  style: string,
  inherited: ReadonlyMap<string, string>
): 'hidden' | 'text-transparent' | null {
  const finals = finalDeclarationsForStyle(style);
  // Inherited declarations seed the environment; the own block
  // overrides them, matching the CSS cascade for custom
  // properties.
  const customs = new Map<string, string>(inherited);
  for (const [name, entry] of finals) {
    if (name.startsWith('--')) customs.set(name, entry.value);
  }
  const finalValue = (property: string): string | undefined => {
    const entry = finals.get(property);
    if (entry === undefined) return undefined;
    // Hiding keywords hide behind same-block custom properties
    // (`--state:none;display:var(--state)`), which the browser
    // resolves before matching.
    return resolveCssVariableReferences(entry.value, customs);
  };
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
    if (collapsesBoxToZero(transform, 'transform-list')) {
      return 'hidden';
    }
  }
  const scale = finalValue('scale');
  if (scale !== undefined && scale !== 'none') {
    if (collapsesBoxToZero(scale, 'scale-property')) {
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
    const utility = hidingUtilityForStyle(
      element.getAttribute('style') ?? '',
      inheritedCustomProperties(element)
    );
    if (utility !== null) element.classList.add(utility);
  }
  return doc.body.innerHTML;
}
