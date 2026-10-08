import { matchMediaElements } from './review-handoff-media-elements';
import { tagAttributes } from './review-handoff-tag-attributes';
import { stripHtmlComments } from './strip-html-comments';
import { stripNonRenderingText } from './strip-non-rendering-text';

function isZeroSizedImage(tag: string): boolean {
  // A zero width or height renders no pixels. Only bare zeros count: the
  // width/height attributes take plain pixel counts, so `0px` is invalid
  // and ignored by browsers (natural size, still visible).
  for (const { name, value } of tagAttributes(tag)) {
    if (name !== 'width' && name !== 'height') continue;
    if (/^0+$/.test(value.trim())) return true;
  }
  return false;
}

// Non-overridable hiding: display:none removes the subtree, group
// opacity and clipping apply to the whole rendered element, so no
// descendant can reappear. `invisible` is deliberately absent: the
// visibility property inherits but a descendant `visible` overrides
// it, so visibility is tracked separately below.
const IMAGE_HIDING_CLASS_TOKENS = new Set(['hidden', 'opacity-0', 'sr-only']);
// text-transparent sets only `color: transparent`: it hides glyphs but not
// decoded image pixels, so it joins the text set alone.
const TEXT_HIDING_CLASS_TOKENS = new Set([
  ...IMAGE_HIDING_CLASS_TOKENS,
  'text-transparent',
]);

function tagHasHidingClass(tag: string, tokens: ReadonlySet<string>): boolean {
  // The sanitizer preserves class but strips style, so hidden subtrees
  // arrive only as Tailwind tokens. Match exact tokens: `hidden` must not
  // match `unhidden`.
  for (const { name, value } of tagAttributes(tag)) {
    if (name !== 'class') continue;
    const classes = value.split(/\s+/);
    if (classes.some((token) => tokens.has(token))) {
      return true;
    }
  }
  return false;
}

function hasClippedZeroHeightClass(tag: string): boolean {
  // max-h-0 caps the box at zero height but content still overflows
  // visibly; overflow-hidden clips but sizes normally. Only the pair
  // hides, so each utility alone must keep matching as visible.
  for (const { name, value } of tagAttributes(tag)) {
    if (name !== 'class') continue;
    const classes = value.split(/\s+/);
    if (classes.includes('max-h-0') && classes.includes('overflow-hidden')) {
      return true;
    }
  }
  return false;
}

function hasVisibilityHidingClass(tag: string): boolean {
  return (
    tagHasHidingClass(tag, IMAGE_HIDING_CLASS_TOKENS) ||
    hasClippedZeroHeightClass(tag)
  );
}

function hasTextHidingClass(tag: string): boolean {
  return (
    tagHasHidingClass(tag, TEXT_HIDING_CLASS_TOKENS) ||
    hasClippedZeroHeightClass(tag)
  );
}

type HidingFrame = {
  terminal: boolean;
  visibility: 'visible' | 'invisible' | null;
};

function elementVisibility(tag: string): 'visible' | 'invisible' | null {
  for (const { name, value } of tagAttributes(tag)) {
    if (name !== 'class') continue;
    const classes = value.split(/\s+/);
    // A pathological element carrying both markers resolves to visible,
    // matching the override direction.
    if (classes.includes('visible')) return 'visible';
    if (classes.includes('invisible')) return 'invisible';
  }
  return null;
}

function subtreeHidden(frames: readonly HidingFrame[]): boolean {
  if (frames.some((frame) => frame.terminal)) return true;
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const marker = frames[index].visibility;
    if (marker !== null) return marker === 'invisible';
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
    });
  }
  frames.push({
    terminal: hasVisibilityHidingClass(tag),
    visibility: elementVisibility(tag),
  });
  return subtreeHidden(frames);
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
    if (!subtreeHidden(frames)) {
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
    });
  }
  if (!subtreeHidden(frames)) {
    segments.push(withoutComments.slice(position));
  }
  return segments.join('');
}

export function hasReadableContent(content: string): boolean {
  // A bare <source> renders nothing without an accompanying <img>, and a
  // zero-sized or CSS-hidden <img> renders no pixels either — whether the
  // hiding class sits on the image itself or on an ancestor. Terminal
  // hiding (display, opacity, clipping) wins anywhere, while inherited
  // `invisible` yields to the nearest `visible` descendant. Text gets
  // the same ancestry handling through visibleText. Comments render
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
