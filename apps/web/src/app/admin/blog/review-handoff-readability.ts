import { showingMarkers } from './review-handoff-showing-markers';
import { tagAttributes } from './review-handoff-tag-attributes';
import { stripHtmlComments } from './strip-html-comments';
import { stripNonRenderingText } from './strip-non-rendering-text';
import { stripRawTextBlocks } from './strip-raw-text-blocks';

function isZeroSizedImage(tag: string): boolean {
  // A zero width or height renders no pixels. Only bare zeros count: the
  // width/height attributes take plain pixel counts, so `0px` is invalid
  // and ignored by browsers (natural size, still visible). Zero-size
  // utilities on the image itself need no overflow rule: replaced
  // content conforms to the zero box instead of overflowing it. CSS
  // beats presentational attributes, so any base or responsive size
  // utility restores a zero attribute, per constraint kind like the
  // clipping path — while a zeroed class token still needs a
  // responsive override, since same-layer utility order is unproven.
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
  const markers = showingMarkers(classes);
  const heightZero =
    (classes.some((token) => ZERO_HEIGHT_CLASS_TOKENS.has(token)) &&
      !markers.heightRestored) ||
    (heightAttrZero &&
      !markers.heightRestored &&
      !markers.baseHeightRestored) ||
    (classes.includes('max-h-0') && !markers.maxHeightRestored);
  const widthZero =
    (classes.some((token) => ZERO_WIDTH_CLASS_TOKENS.has(token)) &&
      !markers.widthRestored) ||
    (widthAttrZero && !markers.widthRestored && !markers.baseWidthRestored) ||
    (classes.includes('max-w-0') && !markers.maxWidthRestored);
  return heightZero || widthZero;
}

// Same-element hiding: display:none removes the subtree, group opacity
// and clipping apply to the whole rendered element, so no descendant
// can reappear — but a responsive override on the same element
// (`hidden md:block`) renders at that breakpoint. `invisible` and
// `text-transparent` are deliberately absent: visibility and color
// inherit, so a descendant `visible` or opaque text color overrides
// them, and both are tracked as markers below.
function tagHasTerminalHidingClass(tag: string): boolean {
  // The sanitizer preserves class but strips style, so hidden subtrees
  // arrive only as Tailwind tokens. Match exact tokens: `hidden` must not
  // match `unhidden`. Each hiding utility needs its own override kind:
  // visibility does not restore display, and display does not restore
  // visibility.
  for (const { name, value } of tagAttributes(tag)) {
    if (name !== 'class') continue;
    const classes = value.split(/\s+/);
    const markers = showingMarkers(classes);
    if (classes.includes('hidden') && !markers.display) return true;
    if (classes.includes('opacity-0') && !markers.opacity) return true;
    if (classes.includes('sr-only') && !markers.notSrOnly) return true;
    if (markers.scaleXZero && !markers.scaleXRestored) return true;
    if (markers.scaleYZero && !markers.scaleYRestored) return true;
  }
  return false;
}

const ZERO_HEIGHT_CLASS_TOKENS = new Set(['h-0', 'size-0']);
const ZERO_WIDTH_CLASS_TOKENS = new Set(['w-0', 'size-0']);
const CLIP_X_CLASS_TOKENS = new Set([
  'overflow-hidden',
  'overflow-clip',
  'overflow-x-hidden',
  'overflow-x-clip',
]);
const CLIP_Y_CLASS_TOKENS = new Set([
  'overflow-hidden',
  'overflow-clip',
  'overflow-y-hidden',
  'overflow-y-clip',
]);

function hasClippedZeroSizeClass(tag: string): boolean {
  // A zeroed axis alone still overflows visibly, and clipping alone
  // sizes normally: only a zeroed axis paired with clipping on that
  // same axis hides. Cross-axis pairs (h-0 with overflow-x-hidden)
  // overflow visibly on the unclipped axis and stay readable. A
  // responsive size override restores its own constraint kind only:
  // max-h-0 still caps the box after md:h-auto.
  for (const { name, value } of tagAttributes(tag)) {
    if (name !== 'class') continue;
    const classes = value.split(/\s+/);
    const markers = showingMarkers(classes);
    const zeroHeight =
      (classes.some((token) => ZERO_HEIGHT_CLASS_TOKENS.has(token)) &&
        !markers.heightRestored) ||
      (classes.includes('max-h-0') && !markers.maxHeightRestored);
    const zeroWidth =
      (classes.some((token) => ZERO_WIDTH_CLASS_TOKENS.has(token)) &&
        !markers.widthRestored) ||
      (classes.includes('max-w-0') && !markers.maxWidthRestored);
    const clipsX = classes.some((token) => CLIP_X_CLASS_TOKENS.has(token));
    const clipsY = classes.some((token) => CLIP_Y_CLASS_TOKENS.has(token));
    if ((zeroHeight && clipsY) || (zeroWidth && clipsX)) {
      return true;
    }
  }
  return false;
}

function hasVisibilityHidingClass(tag: string): boolean {
  return tagHasTerminalHidingClass(tag) || hasClippedZeroSizeClass(tag);
}

function hasTextHidingClass(tag: string): boolean {
  // Transparent text color is tracked per frame as an overridable
  // marker, so the terminal text set matches the visibility set.
  return tagHasTerminalHidingClass(tag) || hasClippedZeroSizeClass(tag);
}

type HidingFrame = {
  terminal: boolean;
  visibility: 'visible' | 'invisible' | null;
  color: 'opaque' | 'transparent' | null;
};

function elementVisibility(tag: string): 'visible' | 'invisible' | null {
  for (const { name, value } of tagAttributes(tag)) {
    if (name !== 'class') continue;
    const classes = value.split(/\s+/);
    // A pathological element carrying both markers resolves to visible,
    // matching the override direction. A responsive `visible` counts:
    // content shown at any breakpoint is readable.
    if (showingMarkers(classes).visible) return 'visible';
    if (classes.includes('invisible')) return 'invisible';
  }
  return null;
}

function elementColor(tag: string): 'opaque' | 'transparent' | null {
  for (const { name, value } of tagAttributes(tag)) {
    if (name !== 'class') continue;
    const markers = showingMarkers(value.split(/\s+/));
    // Same-layer color conflicts resolve by generated precedence
    // (alphabetically last wins), so a transparent winner beats
    // text-black while text-white beats transparent. current/inherit
    // winners pass through to the ancestor frames. A background
    // clipped to the glyphs renders transparent text like opaque.
    if (markers.opaqueColor || markers.clippedBackground) return 'opaque';
    if (markers.transparentColor) return 'transparent';
  }
  return null;
}

function subtreeHidden(
  frames: readonly HidingFrame[],
  includeColor: boolean
): boolean {
  if (frames.some((frame) => frame.terminal)) return true;
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const marker = frames[index].visibility;
    if (marker !== null) return marker === 'invisible';
  }
  // Transparent color hides glyphs but not decoded image pixels, so
  // only the text path consults it. Like visibility, the nearest
  // marker wins and an opaque descendant escapes a transparent
  // ancestor.
  if (includeColor) {
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      const marker = frames[index].color;
      if (marker !== null) return marker === 'transparent';
    }
  }
  return false;
}

const HTML_TAG_PATTERN =
  /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const VOID_HTML_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function hasVisibleImage(content: string): boolean {
  // Track ancestry during one document-order pass instead of rescanning
  // the prefix before every image: each image is evaluated against the
  // live stack the moment it is reached, keeping validation linear in
  // article size. The stack discipline matches visibleText exactly, so
  // verdicts are unchanged — only the quadratic rescan is gone. The
  // image's own frame joins the evaluation so a `visible` image
  // escapes an `invisible` ancestor, while terminal hiding anywhere
  // still wins.
  const frames: HidingFrame[] = [];
  for (const match of content.matchAll(HTML_TAG_PATTERN)) {
    if (match[1] === '/') {
      frames.pop();
      continue;
    }
    const tagName = match[2].toLowerCase();
    if (tagName === 'img') {
      const tag = match[0];
      if (!isZeroSizedImage(tag)) {
        frames.push({
          terminal: hasVisibilityHidingClass(tag),
          visibility: elementVisibility(tag),
          color: elementColor(tag),
        });
        const hidden = subtreeHidden(frames, false);
        frames.pop();
        if (!hidden) return true;
      }
      continue;
    }
    if (VOID_HTML_ELEMENTS.has(tagName)) continue;
    frames.push({
      terminal: hasVisibilityHidingClass(match[0]),
      visibility: elementVisibility(match[0]),
      color: elementColor(match[0]),
    });
  }
  return false;
}

function visibleText(content: string): string {
  // Collect text nodes outside hidden subtrees with the same ancestry
  // stack as images. Comments are stripped first: the tag pattern does
  // not match them, so their text must not leak in as visible segments.
  const frames: HidingFrame[] = [];
  const segments: string[] = [];
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
  let position = 0;
  for (const match of withoutComments.matchAll(HTML_TAG_PATTERN)) {
    const index = match.index ?? withoutComments.length;
    if (!subtreeHidden(frames, true)) {
      segments.push(withoutComments.slice(position, index));
    }
    position = index + match[0].length;
    if (match[1] === '/') {
      frames.pop();
      continue;
    }
    if (VOID_HTML_ELEMENTS.has(match[2].toLowerCase())) continue;
    frames.push({
      terminal: hasTextHidingClass(match[0]),
      visibility: elementVisibility(match[0]),
      color: elementColor(match[0]),
    });
  }
  if (!subtreeHidden(frames, true)) {
    segments.push(withoutComments.slice(position));
  }
  return segments.join('');
}

export function hasReadableContent(content: string): boolean {
  // A bare <source> renders nothing without an accompanying <img>, and a
  // zero-sized or CSS-hidden <img> renders no pixels either — whether the
  // hiding class sits on the image itself or on an ancestor. Terminal
  // hiding (display, opacity, clipping) wins anywhere, while inherited
  // `invisible` yields to the nearest `visible` descendant. A hiding
  // utility paired with a same-element responsive override (`hidden
  // md:block`) renders at that breakpoint and is not hiding at all. Text gets
  // the same ancestry handling through visibleText, plus an overridable
  // color marker so opaque text escapes a `text-transparent` ancestor
  // (glyph-only: images under transparent text still count). Comments render
  // nothing, so strip them before matching: a commented-out <img> must
  // neither satisfy readability itself nor donate a hidden ancestor.
  const withoutComments = stripRawTextBlocks(stripHtmlComments(content));
  if (hasVisibleImage(withoutComments)) return true;
  const text = stripNonRenderingText(
    visibleText(withoutComments).replace(/&nbsp;/gi, ' ')
  ).trim();
  return text.length > 0;
}
