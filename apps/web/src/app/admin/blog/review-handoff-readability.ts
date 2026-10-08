import { matchMediaElements } from './review-handoff-media-elements';
import { showingMarkers } from './review-handoff-showing-markers';
import { tagAttributes } from './review-handoff-tag-attributes';
import { stripHtmlComments } from './strip-html-comments';
import { stripNonRenderingText } from './strip-non-rendering-text';

function isZeroSizedImage(tag: string): boolean {
  // A zero width or height renders no pixels. Only bare zeros count: the
  // width/height attributes take plain pixel counts, so `0px` is invalid
  // and ignored by browsers (natural size, still visible). Zero-size
  // utilities on the image itself need no overflow rule: replaced
  // content conforms to the zero box instead of overflowing it. CSS
  // beats presentational attributes, so a responsive size utility
  // restores zeroed tokens and zero attributes alike at its
  // breakpoint, per constraint kind like the clipping path.
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
    ((classes.some((token) => ZERO_HEIGHT_CLASS_TOKENS.has(token)) ||
      heightAttrZero) &&
      !markers.heightRestored) ||
    (classes.includes('max-h-0') && !markers.maxHeightRestored);
  const widthZero =
    ((classes.some((token) => ZERO_WIDTH_CLASS_TOKENS.has(token)) ||
      widthAttrZero) &&
      !markers.widthRestored) ||
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
    const classes = value.split(/\s+/);
    // A pathological element carrying both markers resolves to opaque,
    // matching the override direction. Responsive opaque colors count
    // the same as exact ones.
    if (showingMarkers(classes).opaqueColor) return 'opaque';
    if (classes.includes('text-transparent')) return 'transparent';
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

function hasHiddenAncestor(
  content: string,
  tag: string,
  tagIndex: number
): boolean {
  // The sanitizer re-serializes balanced markup, so a stack over the tags
  // preceding the image mirrors its live DOM ancestry. The image's own
  // frame joins the evaluation so a `visible` image escapes an
  // `invisible` ancestor, while terminal hiding anywhere still wins.
  const frames: HidingFrame[] = [];
  for (const match of content.matchAll(HTML_TAG_PATTERN)) {
    if ((match.index ?? content.length) >= tagIndex) break;
    if (match[1] === '/') {
      frames.pop();
      continue;
    }
    if (VOID_HTML_ELEMENTS.has(match[2].toLowerCase())) continue;
    frames.push({
      terminal: hasVisibilityHidingClass(match[0]),
      visibility: elementVisibility(match[0]),
      color: elementColor(match[0]),
    });
  }
  frames.push({
    terminal: hasVisibilityHidingClass(tag),
    visibility: elementVisibility(tag),
    color: elementColor(tag),
  });
  return subtreeHidden(frames, false);
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
  const withoutComments = stripHtmlComments(content);
  for (const match of matchMediaElements(withoutComments)) {
    if (!/^<img\b/i.test(match[0])) continue;
    const tag = match[0];
    if (isZeroSizedImage(tag)) continue;
    const index = match.index ?? withoutComments.length;
    if (!hasHiddenAncestor(withoutComments, tag, index)) {
      return true;
    }
  }
  const text = stripNonRenderingText(
    visibleText(withoutComments).replace(/&nbsp;/gi, ' ')
  ).trim();
  return text.length > 0;
}
