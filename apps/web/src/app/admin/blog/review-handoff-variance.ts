import type { ColorScheme } from './review-handoff-breakpoints';
import { elementFrame } from './review-handoff-element-frame';
import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';
import { imageSizeZeroAt } from './review-handoff-image-size';
import { stripImportantModifier } from './review-handoff-important';
import { HidingStack } from './review-handoff-subtree-hidden';
import { tagAttributes } from './review-handoff-tag-attributes';
import { VOID_HTML_ELEMENTS } from './review-handoff-void-elements';
import { stripHtmlComments } from './strip-html-comments';

// Without a variant prefix every layer is bare, so each element's
// verdict is constant across points and schemes: skip the ancestry
// walk entirely for the common class-less article. A colon followed
// by a URL authority (`https://`) is not a variant.
const VARIANCE_PREFIX_PATTERN = /:(?!\/\/)[[a-z]/i;

// Variants the width model evaluates exactly.
const KNOWN_WIDTH_VARIANTS = new Set([
  'sm',
  'md',
  'lg',
  'xl',
  '2xl',
  'max-sm',
  'max-md',
  'max-lg',
  'max-xl',
  'max-2xl',
  'dark',
]);

// State variants that never change at-rest rendering: the editor
// keeps the resting state, so hiding gated on these alone is moot.
// Structural (`first:`), orientation (`portrait:`), condition
// (`supports-[]:`, `data-[]:`), and media-query (`motion-reduce:`,
// `print:`, ...) variants are deliberately absent: they can hide
// content at rest, so they reject below.
const AT_REST_NEUTRAL_VARIANTS = new Set([
  'hover',
  'focus',
  'focus-within',
  'focus-visible',
  'active',
  'visited',
  'target',
  'disabled',
  'enabled',
  'checked',
  'indeterminate',
  'default',
  'required',
  'valid',
  'invalid',
  'in-range',
  'out-of-range',
  'placeholder-shown',
  'autofill',
  'read-only',
  'open',
]);

function isKnownVariant(variant: string): boolean {
  return (
    KNOWN_WIDTH_VARIANTS.has(variant) ||
    AT_REST_NEUTRAL_VARIANTS.has(variant) ||
    variant.startsWith('group-') ||
    variant.startsWith('peer-')
  );
}

// Bare utilities that read or flip a hiding channel, hiding and
// showing alike: an unknown variant on `block` can show below an
// arbitrary threshold what the bare `hidden` conceals, so showing
// overrides reject exactly like hiding ones.
const CHANNEL_EXACT_UTILITIES = new Set([
  'hidden',
  'visible',
  'invisible',
  'collapse',
  'sr-only',
  'not-sr-only',
  'bg-clip-text',
  'truncate',
  'block',
  'inline-block',
  'inline',
  'flow-root',
  'flex',
  'inline-flex',
  'grid',
  'inline-grid',
  'contents',
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
  'list-item',
  'scale-0',
  'scale-x-0',
  'scale-y-0',
  'w-0',
  'h-0',
  'size-0',
]);

const CHANNEL_UTILITY_PREFIXES = [
  'opacity-',
  'text-',
  'overflow-',
  'line-clamp-',
];

function isChannelUtility(utility: string): boolean {
  if (CHANNEL_EXACT_UTILITIES.has(utility)) return true;
  return CHANNEL_UTILITY_PREFIXES.some((prefix) => utility.startsWith(prefix));
}

function wrapsUnsupportedVariant(token: string): boolean {
  // Colons inside arbitrary values (`supports-[a:b]:hidden`) split
  // into extra segments, but any unrecognized segment still rejects:
  // only fully-known variant stacks defer to the width model.
  // Stacked width variants (`md:max-lg:hidden`) form rankless layers
  // the width model cannot evaluate, so they reject even though each
  // segment is known alone; scheme (`dark:`) still stacks freely.
  const segments = stripImportantModifier(token).split(':');
  if (segments.length < 2) return false;
  if (!isChannelUtility(segments[segments.length - 1])) return false;
  const variants = segments.slice(0, -1);
  if (variants.some((variant) => !isKnownVariant(variant))) return true;
  const widthCount = variants.filter(
    (variant) => variant !== 'dark' && KNOWN_WIDTH_VARIANTS.has(variant)
  ).length;
  return widthCount > 1;
}

function hasUnsupportedVariantChannelUtility(content: string): boolean {
  for (const match of content.matchAll(HTML_TAG_PATTERN)) {
    if (match[1] === '/') continue;
    if (match[2].toLowerCase() === 'source') continue;
    for (const { name, value } of tagAttributes(match[0])) {
      if (name !== 'class') continue;
      for (const token of value.split(/\s+/)) {
        if (wrapsUnsupportedVariant(token)) return true;
      }
    }
  }
  return false;
}

function verdictsVary(hiddenAt: readonly boolean[]): boolean {
  return hiddenAt.some((hidden) => hidden !== hiddenAt[0]);
}

function imageZeroVaries(tag: string): boolean {
  // Replaced content conforms to a zeroed axis without needing a
  // clipping rule, so an image's own zero sizing varies independently
  // of the generic frame verdicts: `h-0 md:h-auto` renders nothing
  // below md whatever the ancestry says.
  const classes: string[] = [];
  let widthAttrZero = false;
  let heightAttrZero = false;
  for (const { name, value } of tagAttributes(tag)) {
    if (name === 'class') {
      classes.push(...value.split(/\s+/));
      continue;
    }
    if (name === 'width' && /^0+$/.test(value.trim())) widthAttrZero = true;
    if (name === 'height' && /^0+$/.test(value.trim())) heightAttrZero = true;
  }
  const schemes: ColorScheme[] = ['light', 'dark'];
  const runs = schemes.map((scheme) =>
    imageSizeZeroAt(classes, widthAttrZero, heightAttrZero, scheme)
  );
  return (
    runs.some(verdictsVary) ||
    runs[0].some((zero, point) => zero !== runs[1][point])
  );
}

/**
 * Whether any element hides at some evaluation cells but shows at others.
 * The editor drops input classes, so viewport- or theme-dependent hiding
 * cannot survive the round-trip: kept content would surface at viewports
 * or schemes where the source hides it. Effective (ancestry-combined)
 * verdicts decide, mirroring the strip: terminal hiding anywhere wins,
 * visibility and color resolve to the nearest marker, and void elements
 * never consult the color channel.
 */
export function hasUnrepresentableVariance(content: string): boolean {
  if (!VARIANCE_PREFIX_PATTERN.test(content)) return false;
  const withoutComments = stripHtmlComments(content);
  if (hasUnsupportedVariantChannelUtility(withoutComments)) return true;
  const light = new HidingStack();
  const dark = new HidingStack();
  for (const match of withoutComments.matchAll(HTML_TAG_PATTERN)) {
    if (match[1] === '/') {
      light.pop();
      dark.pop();
      continue;
    }
    const tagName = match[2].toLowerCase();
    // Source classes select nothing, so responsive variants on a
    // source cannot vary rendering: skip it instead of rejecting.
    if (tagName === 'source') continue;
    if (tagName === 'img' && imageZeroVaries(match[0])) return true;
    light.push(elementFrame(match[0], 'light'));
    dark.push(elementFrame(match[0], 'dark'));
    const includeColor = !VOID_HTML_ELEMENTS.has(tagName);
    const lightHidden = light.hiddenAt(includeColor);
    const darkHidden = dark.hiddenAt(includeColor);
    const varies =
      verdictsVary(lightHidden) ||
      verdictsVary(darkHidden) ||
      lightHidden[0] !== darkHidden[0];
    if (VOID_HTML_ELEMENTS.has(tagName)) {
      light.pop();
      dark.pop();
    }
    if (varies) return true;
  }
  return false;
}
