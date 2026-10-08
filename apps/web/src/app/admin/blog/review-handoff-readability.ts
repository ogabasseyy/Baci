import { BREAKPOINT_POINT_COUNT } from './review-handoff-breakpoints';
import {
  type ColorAtPoint,
  showingMarkers,
  type VisibilityAtPoint,
} from './review-handoff-showing-markers';
import { imageSizeZeroAt } from './review-handoff-size-markers';
import { tagAttributes } from './review-handoff-tag-attributes';
import { stripHtmlComments } from './strip-html-comments';
import { stripNonRenderingText } from './strip-non-rendering-text';
import { stripRawTextBlocks } from './strip-raw-text-blocks';

function imageZeroAt(tag: string): boolean[] {
  // A zero width or height renders no pixels. Only bare zeros count:
  // the width/height attributes take plain pixel counts, so `0px` is
  // invalid and ignored by browsers (natural size, still visible).
  // Zero-size utilities on the image itself need no overflow rule:
  // replaced content conforms to the zero box instead of
  // overflowing it.
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
  return imageSizeZeroAt(classes, widthAttrZero, heightAttrZero);
}

// Same-element hiding: display:none removes the subtree, group opacity
// and clipping apply to the whole rendered element, so no descendant
// can reappear — but a responsive override on the same element
// (`hidden md:block`) renders at the points it covers. `invisible`
// and `text-transparent` are deliberately absent: visibility and color
// inherit, so a descendant `visible` or opaque text color overrides
// them, and both are tracked as markers below.
function tagTerminalAt(tag: string): boolean[] {
  // The sanitizer preserves class but strips style, so hidden subtrees
  // arrive only as Tailwind tokens.
  const terminalAt = new Array<boolean>(BREAKPOINT_POINT_COUNT).fill(false);
  for (const { name, value } of tagAttributes(tag)) {
    if (name !== 'class') continue;
    const markers = showingMarkers(value.split(/\s+/));
    for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
      terminalAt[point] = terminalAt[point] || markers.terminalAt[point];
    }
  }
  return terminalAt;
}

type HidingFrame = {
  terminalAt: boolean[];
  visibilityAt: VisibilityAtPoint[];
  colorAt: ColorAtPoint[];
};

function nullVisibilityAt(): VisibilityAtPoint[] {
  return new Array<VisibilityAtPoint>(BREAKPOINT_POINT_COUNT).fill(null);
}

function nullColorAt(): ColorAtPoint[] {
  return new Array<ColorAtPoint>(BREAKPOINT_POINT_COUNT).fill(null);
}

function elementVisibilityAt(tag: string): VisibilityAtPoint[] {
  for (const { name, value } of tagAttributes(tag)) {
    if (name !== 'class') continue;
    // A pathological element carrying both markers resolves per
    // point to the latest applicable winner. Content shown at any
    // point is readable.
    return showingMarkers(value.split(/\s+/)).visibilityAt;
  }
  return nullVisibilityAt();
}

function elementColorAt(tag: string): ColorAtPoint[] {
  for (const { name, value } of tagAttributes(tag)) {
    if (name !== 'class') continue;
    // Same-layer color conflicts resolve by generated precedence
    // (naturally last wins), so a transparent winner beats
    // text-black while text-white beats transparent. current/inherit
    // winners pass through to the ancestor frames. A background
    // clipped to the glyphs renders transparent text like opaque.
    return showingMarkers(value.split(/\s+/)).colorAt;
  }
  return nullColorAt();
}

function subtreeHiddenAt(
  frames: readonly HidingFrame[],
  includeColor: boolean
): boolean[] {
  const hiddenAt: boolean[] = [];
  for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
    if (frames.some((frame) => frame.terminalAt[point])) {
      hiddenAt.push(true);
      continue;
    }
    let hidden: boolean | null = null;
    for (let index = frames.length - 1; index >= 0; index -= 1) {
      const marker = frames[index].visibilityAt[point];
      if (marker !== null) {
        hidden = marker === 'invisible';
        break;
      }
    }
    // Transparent color hides glyphs but not decoded image pixels, so
    // only the text path consults it. Like visibility, the nearest
    // marker wins and an opaque descendant escapes a transparent
    // ancestor.
    if (hidden === null && includeColor) {
      for (let index = frames.length - 1; index >= 0; index -= 1) {
        const marker = frames[index].colorAt[point];
        if (marker !== null) {
          hidden = marker === 'transparent';
          break;
        }
      }
    }
    hiddenAt.push(hidden ?? false);
  }
  return hiddenAt;
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

function elementFrame(tag: string): HidingFrame {
  return {
    terminalAt: tagTerminalAt(tag),
    visibilityAt: elementVisibilityAt(tag),
    colorAt: elementColorAt(tag),
  };
}

function visibleAtAnyPoint(hiddenAt: readonly boolean[]): boolean {
  return hiddenAt.some((hidden) => !hidden);
}

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
      const zeroAt = imageZeroAt(tag);
      frames.push(elementFrame(tag));
      const hiddenAt = subtreeHiddenAt(frames, false);
      frames.pop();
      if (zeroAt.some((zero, point) => !zero && !hiddenAt[point])) {
        return true;
      }
      continue;
    }
    if (VOID_HTML_ELEMENTS.has(tagName)) continue;
    frames.push(elementFrame(match[0]));
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
    if (visibleAtAnyPoint(subtreeHiddenAt(frames, true))) {
      segments.push(withoutComments.slice(position, index));
    }
    position = index + match[0].length;
    if (match[1] === '/') {
      frames.pop();
      continue;
    }
    if (VOID_HTML_ELEMENTS.has(match[2].toLowerCase())) continue;
    frames.push(elementFrame(match[0]));
  }
  if (visibleAtAnyPoint(subtreeHiddenAt(frames, true))) {
    segments.push(withoutComments.slice(position));
  }
  return segments.join('');
}

function isAllTerminal(tag: string): boolean {
  return tagTerminalAt(tag).every(Boolean);
}

export function stripHiddenContent(content: string): string {
  // Remove subtrees hidden at every evaluation point: an element
  // whose own terminal markers (or an ancestor's) hide all points
  // can never render, and the editor drops input classes — so kept
  // markup would surface on mount. Visibility/color hiding stays:
  // descendants escape with visible/opaque winners, which needs
  // subtree lookahead this single pass cannot prove.
  const segments: string[] = [];
  const dropStack: boolean[] = [];
  let position = 0;
  for (const match of content.matchAll(HTML_TAG_PATTERN)) {
    const index = match.index ?? content.length;
    if (!dropStack.some(Boolean)) {
      segments.push(content.slice(position, index));
    }
    position = index + match[0].length;
    if (match[1] === '/') {
      const dropped = dropStack.pop();
      if (!dropped && !dropStack.some(Boolean)) segments.push(match[0]);
      continue;
    }
    const dropped = dropStack.some(Boolean) || isAllTerminal(match[0]);
    if (VOID_HTML_ELEMENTS.has(match[2].toLowerCase())) {
      if (!dropped) segments.push(match[0]);
      continue;
    }
    dropStack.push(dropped);
    if (!dropped) segments.push(match[0]);
  }
  if (!dropStack.some(Boolean)) segments.push(content.slice(position));
  return segments.join('');
}

export function hasReadableContent(content: string): boolean {
  // A bare <source> renders nothing without an accompanying <img>, and a
  // zero-sized or CSS-hidden <img> renders no pixels either — whether the
  // hiding class sits on the image itself or on an ancestor. Terminal
  // hiding (display, opacity, clipping) wins anywhere, while inherited
  // `invisible` yields to the nearest `visible` descendant. A hiding
  // utility paired with a same-element responsive override (`hidden
  // md:block`) renders at the points it covers and is hiding only
  // where no override applies. Every channel resolves jointly per
  // breakpoint: `opacity-0 md:opacity-100` with `text-black
  // md:text-transparent` stays hidden at every point. Text gets
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
