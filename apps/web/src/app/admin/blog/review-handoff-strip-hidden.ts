// Strip markup that can never render before the editor mounts.
// The editor drops input classes, so any kept hidden content would
// surface visibly. Terminal hiding (display, opacity, collapsing,
// zero scale, clipped zero size) admits no descendant escape, so
// terminal-hidden subtrees drop wholesale. Visibility and color
// hiding do admit escapes (`visible`, opaque colors), so those
// elements drop only when every element child also drops — leaves
// need no lookahead. Transparent color hides glyphs but not image
// pixels, so void elements (img, br) ignore the color channel, and
// text segments hidden at every point drop even under a kept
// ancestor whose escaping child must stay.
import {
  elementFrame,
  type HidingFrame,
  HTML_TAG_PATTERN,
  subtreeHiddenAt,
  VOID_HTML_ELEMENTS,
} from './review-handoff-readability';

type ElementRecord = {
  parent: number;
  frame: HidingFrame;
  tagName: string;
};

function chainFrames(
  elements: readonly ElementRecord[],
  index: number
): HidingFrame[] {
  const chain: HidingFrame[] = [];
  let at = index;
  while (at !== -1) {
    chain.unshift(elements[at].frame);
    at = elements[at].parent;
  }
  return chain;
}

function hiddenEverywhere(
  elements: readonly ElementRecord[],
  index: number,
  includeColor: boolean
): boolean {
  return subtreeHiddenAt(chainFrames(elements, index), includeColor).every(
    Boolean
  );
}

function recordElements(content: string): ElementRecord[] {
  const elements: ElementRecord[] = [];
  const stack: number[] = [];
  for (const match of content.matchAll(HTML_TAG_PATTERN)) {
    if (match[1] === '/') {
      stack.pop();
      continue;
    }
    const tagName = match[2].toLowerCase();
    const index = elements.length;
    elements.push({
      parent: stack.length === 0 ? -1 : stack[stack.length - 1],
      frame: elementFrame(match[0]),
      tagName,
    });
    if (!VOID_HTML_ELEMENTS.has(tagName)) stack.push(index);
  }
  return elements;
}

export function stripHiddenContent(content: string): string {
  const elements = recordElements(content);
  // Bottom-up: parents always record before their children, so
  // reverse order decides children first. An element drops when it
  // hides at every point and no element child survives; void
  // elements never consult the color channel.
  const selfDrop: boolean[] = new Array(elements.length).fill(false);
  const childrenOf = new Map<number, number[]>();
  elements.forEach((element, index) => {
    if (element.parent === -1) return;
    const siblings = childrenOf.get(element.parent) ?? [];
    siblings.push(index);
    childrenOf.set(element.parent, siblings);
  });
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const hidden = VOID_HTML_ELEMENTS.has(elements[index].tagName)
      ? hiddenEverywhere(elements, index, false)
      : hiddenEverywhere(elements, index, true);
    const childrenDrop = (childrenOf.get(index) ?? []).every(
      (child) => selfDrop[child]
    );
    selfDrop[index] = hidden && childrenDrop;
  }
  const finalDrop: boolean[] = new Array(elements.length).fill(false);
  elements.forEach((element, index) => {
    finalDrop[index] =
      selfDrop[index] || (element.parent !== -1 && finalDrop[element.parent]);
  });
  // Rebuild, skipping dropped subtrees and text hidden at every
  // point. Stray close tags are preserved as text-adjacent markup.
  const byOpenStart = new Map<number, number>();
  {
    let seen = 0;
    for (const match of content.matchAll(HTML_TAG_PATTERN)) {
      if (match[1] === '/') continue;
      byOpenStart.set(match.index ?? content.length, seen);
      seen += 1;
    }
  }
  const segments: string[] = [];
  const openStack: number[] = [];
  let position = 0;
  const insideDropped = () => openStack.some((open) => finalDrop[open]);
  for (const match of content.matchAll(HTML_TAG_PATTERN)) {
    const start = match.index ?? content.length;
    const textHidden =
      openStack.length > 0 &&
      subtreeHiddenAt(
        openStack.map((open) => elements[open].frame),
        true
      ).every(Boolean);
    if (!insideDropped() && !textHidden) {
      segments.push(content.slice(position, start));
    }
    position = start + match[0].length;
    if (match[1] === '/') {
      const top = openStack.pop();
      if ((top === undefined || !finalDrop[top]) && !insideDropped()) {
        segments.push(match[0]);
      }
      continue;
    }
    const index = byOpenStart.get(start);
    if (index === undefined) {
      segments.push(match[0]);
      continue;
    }
    if (!VOID_HTML_ELEMENTS.has(elements[index].tagName)) {
      openStack.push(index);
    }
    if (!finalDrop[index] && !insideDropped()) segments.push(match[0]);
  }
  const tailHidden =
    openStack.length > 0 &&
    subtreeHiddenAt(
      openStack.map((open) => elements[open].frame),
      true
    ).every(Boolean);
  if (!insideDropped() && !tailHidden) segments.push(content.slice(position));
  return segments.join('');
}
