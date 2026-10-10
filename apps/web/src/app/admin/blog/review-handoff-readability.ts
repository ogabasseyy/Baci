import type { ColorScheme } from './review-handoff-breakpoints';
import { parseHandoffDom } from './review-handoff-dom';
import { elementFrame } from './review-handoff-element-frame';
import { imageSizeZeroAt } from './review-handoff-image-size';
import { HidingStack } from './review-handoff-subtree-hidden';
import { stripNonRenderingText } from './strip-non-rendering-text';
import { stripRawTextBlocks } from './strip-raw-text-blocks';

function imageZeroAt(img: Element, scheme: ColorScheme): boolean[] {
  // A zero width or height renders no pixels. Only bare zeros count:
  // the width/height attributes take plain pixel counts, so `0px` is
  // invalid and ignored by browsers (natural size, still visible).
  // Zero-size utilities on the image itself need no overflow rule:
  // replaced content conforms to the zero box instead of
  // overflowing it.
  const classes = img.getAttribute('class')?.split(/\s+/) ?? [];
  const widthAttr = img.getAttribute('width');
  const heightAttr = img.getAttribute('height');
  return imageSizeZeroAt(
    classes,
    widthAttr !== null && /^0+$/.test(widthAttr.trim()),
    heightAttr !== null && /^0+$/.test(heightAttr.trim()),
    scheme
  );
}

function visibleAtAnyPoint(hiddenAt: readonly boolean[]): boolean {
  return hiddenAt.some((hidden) => !hidden);
}

type WalkEntry = { element: Element; popAfter: boolean };

function directTextVisible(element: Element, hiding: HidingStack): boolean {
  // The element's own text nodes see exactly this stack: joining
  // them here keeps differently-ancestored text from contaminating
  // the verdict. Blankness decides like the old global join — a
  // surviving character anywhere reads the same either way.
  let direct = '';
  for (const node of element.childNodes) {
    if (node.nodeType === 3) direct += node.nodeValue ?? '';
  }
  if (direct === '') return false;
  const text = stripNonRenderingText(direct.replace(/&nbsp;/gi, ' ')).trim();
  return text.length > 0 && visibleAtAnyPoint(hiding.hiddenAt(true));
}

function readableInScheme(doc: Document, scheme: ColorScheme): boolean {
  // One iterative descent carries the hiding stack: each element
  // pushes its frame, its image verdict and direct text evaluate
  // against the live stack, and the frame pops after the subtree.
  // Deep articles evaluate in linear time with no recursion limit
  // to hit.
  const hiding = new HidingStack();
  const pending: WalkEntry[] = [];
  if (doc.documentElement !== null) {
    pending.push({ element: doc.documentElement, popAfter: false });
  }
  while (pending.length > 0) {
    const { element, popAfter } = pending.pop() as WalkEntry;
    if (popAfter) {
      hiding.pop();
      continue;
    }
    hiding.push(elementFrame(element, scheme));
    if (element.tagName.toLowerCase() === 'img') {
      const zeroAt = imageZeroAt(element, scheme);
      const hiddenAt = hiding.hiddenAt(false);
      if (zeroAt.some((zero, point) => !zero && !hiddenAt[point])) {
        return true;
      }
    }
    if (directTextVisible(element, hiding)) return true;
    pending.push({ element, popAfter: true });
    for (const child of [...element.children].reverse()) {
      pending.push({ element: child, popAfter: false });
    }
  }
  return false;
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
  // the same ancestry handling through the descent, plus an overridable
  // color marker so opaque text escapes a `text-transparent` ancestor
  // (glyph-only: images under transparent text still count). Comments
  // never surface as elements or text nodes, so a commented-out <img>
  // neither satisfies readability itself nor donates a hidden ancestor.
  const withoutRawText = stripRawTextBlocks(content);
  const doc = parseHandoffDom(withoutRawText);
  for (const scheme of ['light', 'dark'] as const) {
    if (readableInScheme(doc, scheme)) return true;
  }
  return false;
}
