import type { ColorScheme } from './review-handoff-breakpoints';
import { isChannelUtility } from './review-handoff-channel-utilities';
import { parseHandoffDom } from './review-handoff-dom';
import { elementFrame } from './review-handoff-element-frame';
import { imageSizeZeroAt } from './review-handoff-image-size';
import { stripImportantModifier } from './review-handoff-important';
import { HidingStack } from './review-handoff-subtree-hidden';
import { VOID_HTML_ELEMENTS } from './review-handoff-void-elements';

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

// Sibling/ancestor states whose absence matches the resting verdict:
// sanitization can strip the controlling input or link, and the
// editor drops the dependent class, so only interaction states that
// rest inactive survive that round-trip. Persistent states
// (checked, disabled, visited, ...) hide in the source exactly when
// the dropped control carries them, exposing the note on import.
const AT_REST_NEUTRAL_MARKER_STATES = new Set([
  'hover',
  'focus',
  'focus-within',
  'focus-visible',
  'active',
]);

function isNeutralMarkerVariant(variant: string): boolean {
  const prefix = variant.startsWith('group-')
    ? 'group-'
    : variant.startsWith('peer-')
      ? 'peer-'
      : null;
  if (prefix === null) return false;
  return AT_REST_NEUTRAL_MARKER_STATES.has(variant.slice(prefix.length));
}

function isKnownVariant(variant: string): boolean {
  return (
    KNOWN_WIDTH_VARIANTS.has(variant) ||
    AT_REST_NEUTRAL_VARIANTS.has(variant) ||
    isNeutralMarkerVariant(variant)
  );
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

function hasUnsupportedVariantChannelUtility(doc: Document): boolean {
  for (const element of doc.querySelectorAll('*')) {
    if (element.tagName.toLowerCase() === 'source') continue;
    for (const token of element.classList) {
      if (wrapsUnsupportedVariant(token)) return true;
    }
  }
  return false;
}

function verdictsVary(hiddenAt: readonly boolean[]): boolean {
  return hiddenAt.some((hidden) => hidden !== hiddenAt[0]);
}

function imageZeroVaries(img: Element): boolean {
  // Replaced content conforms to a zeroed axis without needing a
  // clipping rule, so an image's own zero sizing varies independently
  // of the generic frame verdicts: `h-0 md:h-auto` renders nothing
  // below md whatever the ancestry says.
  const classes = img.getAttribute('class')?.split(/\s+/) ?? [];
  const widthAttr = img.getAttribute('width');
  const heightAttr = img.getAttribute('height');
  const widthAttrZero = widthAttr !== null && /^0+$/.test(widthAttr.trim());
  const heightAttrZero = heightAttr !== null && /^0+$/.test(heightAttr.trim());
  const schemes: ColorScheme[] = ['light', 'dark'];
  const runs = schemes.map((scheme) =>
    imageSizeZeroAt(classes, widthAttrZero, heightAttrZero, scheme)
  );
  return (
    runs.some(verdictsVary) ||
    runs[0].some((zero, point) => zero !== runs[1][point])
  );
}

type WalkEntry = { element: Element; popAfter: boolean };

/**
 * Whether any element hides at some evaluation cells but shows at others.
 * The editor drops input classes, so viewport- or theme-dependent hiding
 * cannot survive the round-trip: kept content would surface at viewports
 * or schemes where the source hides it. Effective (ancestry-combined)
 * verdicts decide, mirroring the strip: terminal hiding anywhere wins,
 * visibility and color resolve to the nearest marker, and void elements
 * never consult the color channel. One iterative descent carries both
 * scheme stacks, so deep articles evaluate in linear time.
 */
export function hasUnrepresentableVariance(content: string): boolean {
  if (!VARIANCE_PREFIX_PATTERN.test(content)) return false;
  // Comments never surface as elements, so variant-looking text
  // inside them cannot vary rendering.
  const doc = parseHandoffDom(content);
  if (hasUnsupportedVariantChannelUtility(doc)) return true;
  const light = new HidingStack();
  const dark = new HidingStack();
  const pending: WalkEntry[] = [];
  if (doc.documentElement !== null) {
    pending.push({ element: doc.documentElement, popAfter: false });
  }
  while (pending.length > 0) {
    const { element, popAfter } = pending.pop() as WalkEntry;
    if (popAfter) {
      light.pop();
      dark.pop();
      continue;
    }
    const tagName = element.tagName.toLowerCase();
    // Source classes select nothing, so responsive variants on a
    // source cannot vary rendering: skip it instead of rejecting.
    if (tagName === 'source') continue;
    if (tagName === 'img' && imageZeroVaries(element)) return true;
    light.push(elementFrame(element, 'light'));
    dark.push(elementFrame(element, 'dark'));
    const includeColor = !VOID_HTML_ELEMENTS.has(tagName);
    const lightHidden = light.hiddenAt(includeColor);
    const darkHidden = dark.hiddenAt(includeColor);
    const varies =
      verdictsVary(lightHidden) ||
      verdictsVary(darkHidden) ||
      lightHidden[0] !== darkHidden[0];
    if (varies) return true;
    pending.push({ element, popAfter: true });
    for (const child of [...element.children].reverse()) {
      pending.push({ element: child, popAfter: false });
    }
  }
  return false;
}
