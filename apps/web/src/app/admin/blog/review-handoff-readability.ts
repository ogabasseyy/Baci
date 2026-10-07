import { tagAttributes } from './review-handoff-tag-attributes';
import { stripNonRenderingText } from './strip-non-rendering-text';

const IMG_TAG_PATTERN = /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu;

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

const IMAGE_HIDING_CLASS_TOKENS = new Set(['hidden', 'invisible', 'opacity-0']);
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

function hasVisibilityHidingClass(tag: string): boolean {
  return tagHasHidingClass(tag, IMAGE_HIDING_CLASS_TOKENS);
}

function hasTextHidingClass(tag: string): boolean {
  return tagHasHidingClass(tag, TEXT_HIDING_CLASS_TOKENS);
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

function hasHiddenAncestor(content: string, imgIndex: number): boolean {
  // The sanitizer re-serializes balanced markup, so a stack over the tags
  // preceding the image mirrors its live DOM ancestry.
  const hiddenStack: boolean[] = [];
  for (const match of content.matchAll(HTML_TAG_PATTERN)) {
    if ((match.index ?? content.length) >= imgIndex) break;
    if (match[1] === '/') {
      hiddenStack.pop();
      continue;
    }
    if (VOID_HTML_ELEMENTS.has(match[2].toLowerCase())) continue;
    hiddenStack.push(hasVisibilityHidingClass(match[0]));
  }
  return hiddenStack.some(Boolean);
}

function visibleText(content: string): string {
  // Collect text nodes outside hidden subtrees with the same ancestry
  // stack as images. Comments are stripped first: the tag pattern does
  // not match them, so their text must not leak in as visible segments.
  const hiddenStack: boolean[] = [];
  const segments: string[] = [];
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
  let position = 0;
  for (const match of withoutComments.matchAll(HTML_TAG_PATTERN)) {
    const index = match.index ?? withoutComments.length;
    if (!hiddenStack.some(Boolean)) {
      segments.push(withoutComments.slice(position, index));
    }
    position = index + match[0].length;
    if (match[1] === '/') {
      hiddenStack.pop();
      continue;
    }
    if (VOID_HTML_ELEMENTS.has(match[2].toLowerCase())) continue;
    hiddenStack.push(hasTextHidingClass(match[0]));
  }
  if (!hiddenStack.some(Boolean)) {
    segments.push(withoutComments.slice(position));
  }
  return segments.join('');
}

export function hasReadableContent(content: string): boolean {
  // A bare <source> renders nothing without an accompanying <img>, and a
  // zero-sized or CSS-hidden <img> renders no pixels either — whether the
  // hiding class sits on the image itself or on an ancestor. Text gets
  // the same ancestry handling through visibleText.
  for (const match of content.matchAll(IMG_TAG_PATTERN)) {
    const tag = match[0];
    if (isZeroSizedImage(tag) || hasVisibilityHidingClass(tag)) continue;
    if (!hasHiddenAncestor(content, match.index ?? content.length)) {
      return true;
    }
  }
  const text = stripNonRenderingText(
    visibleText(content).replace(/&nbsp;/gi, ' ')
  ).trim();
  return text.length > 0;
}
