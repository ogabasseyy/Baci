import type { ColorScheme } from './review-handoff-breakpoints';
import { elementFrame, type HidingFrame } from './review-handoff-element-frame';
import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';
import { imageSizeZeroAt } from './review-handoff-image-size';
import { subtreeHiddenAt } from './review-handoff-subtree-hidden';
import { tagAttributes } from './review-handoff-tag-attributes';
import { VOID_HTML_ELEMENTS } from './review-handoff-void-elements';
import { stripHtmlComments } from './strip-html-comments';
import { stripNonRenderingText } from './strip-non-rendering-text';
import { stripRawTextBlocks } from './strip-raw-text-blocks';

function imageZeroAt(tag: string, scheme: ColorScheme): boolean[] {
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
  return imageSizeZeroAt(classes, widthAttrZero, heightAttrZero, scheme);
}

function visibleAtAnyPoint(hiddenAt: readonly boolean[]): boolean {
  return hiddenAt.some((hidden) => !hidden);
}

function hasVisibleImage(content: string, scheme: ColorScheme): boolean {
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
      const zeroAt = imageZeroAt(tag, scheme);
      frames.push(elementFrame(tag, scheme));
      const hiddenAt = subtreeHiddenAt(frames, false);
      frames.pop();
      if (zeroAt.some((zero, point) => !zero && !hiddenAt[point])) {
        return true;
      }
      continue;
    }
    if (VOID_HTML_ELEMENTS.has(tagName)) continue;
    frames.push(elementFrame(match[0], scheme));
  }
  return false;
}

function visibleText(content: string, scheme: ColorScheme): string {
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
    frames.push(elementFrame(match[0], scheme));
  }
  if (visibleAtAnyPoint(subtreeHiddenAt(frames, true))) {
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
  // Readable in either scheme is readable: dark: layers apply only
  // in the dark run, so content showing under one scheme survives
  // even when hidden under the other.
  for (const scheme of ['light', 'dark'] as const) {
    if (hasVisibleImage(withoutComments, scheme)) return true;
    const text = stripNonRenderingText(
      visibleText(withoutComments, scheme).replace(/&nbsp;/gi, ' ')
    ).trim();
    if (text.length > 0) return true;
  }
  return false;
}
