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
// ancestor whose escaping child must stay. Hiddenness propagates
// down the stack in one traversal: each element combines its own
// frame with its parent's effective state in O(1), so deep valid
// articles strip in linear time.
import { BREAKPOINT_POINT_COUNT } from './review-handoff-breakpoints';
import { elementFrame, type HidingFrame } from './review-handoff-element-frame';
import { HTML_TAG_PATTERN } from './review-handoff-html-tag-pattern';
import type {
  ColorAtPoint,
  VisibilityAtPoint,
} from './review-handoff-showing-markers';
import { VOID_HTML_ELEMENTS } from './review-handoff-void-elements';

type EffectiveHiding = {
  terminal: boolean[];
  visibility: VisibilityAtPoint[];
  color: ColorAtPoint[];
};

function combineEffective(
  parent: EffectiveHiding | null,
  frame: HidingFrame
): EffectiveHiding {
  // Terminal hiding wins anywhere in the chain; visibility and
  // color resolve to the nearest marker, like the readability walk.
  const terminal: boolean[] = [];
  const visibility: VisibilityAtPoint[] = [];
  const color: ColorAtPoint[] = [];
  for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
    terminal.push(
      (parent?.terminal[point] ?? false) || frame.terminalAt[point]
    );
    visibility.push(
      frame.visibilityAt[point] ?? parent?.visibility[point] ?? null
    );
    color.push(frame.colorAt[point] ?? parent?.color[point] ?? null);
  }
  return { terminal, visibility, color };
}

function hiddenEverywhere(
  effective: EffectiveHiding,
  includeColor: boolean
): boolean {
  for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
    if (effective.terminal[point]) continue;
    if (effective.visibility[point] === 'invisible') continue;
    if (includeColor && effective.color[point] === 'transparent') continue;
    return false;
  }
  return true;
}

type ElementRecord = {
  parent: number;
  frames: [HidingFrame, HidingFrame];
  tagName: string;
  hiddenNoColor: boolean;
  hiddenWithColor: boolean;
};

type DualEffective = {
  light: EffectiveHiding;
  dark: EffectiveHiding;
};

function dualEffective(
  parent: DualEffective | null,
  frames: [HidingFrame, HidingFrame]
): DualEffective {
  const top = (dual: DualEffective | null): EffectiveHiding | null =>
    dual === null ? null : dual.light;
  const bottom = (dual: DualEffective | null): EffectiveHiding | null =>
    dual === null ? null : dual.dark;
  return {
    light: combineEffective(top(parent), frames[0]),
    dark: combineEffective(bottom(parent), frames[1]),
  };
}

function visibleDualEffective(): DualEffective {
  // A parentless source element: nothing above it can hide it, and
  // its own frame never applies (see recordElements).
  const visible = (): EffectiveHiding => ({
    color: new Array<ColorAtPoint>(BREAKPOINT_POINT_COUNT).fill(null),
    terminal: new Array<boolean>(BREAKPOINT_POINT_COUNT).fill(false),
    visibility: new Array<VisibilityAtPoint>(BREAKPOINT_POINT_COUNT).fill(null),
  });
  return { dark: visible(), light: visible() };
}

function hiddenEverywhereBoth(
  effective: DualEffective,
  includeColor: boolean
): boolean {
  // An element drops only when hidden under both schemes: readable
  // in either scheme is readable.
  return (
    hiddenEverywhere(effective.light, includeColor) &&
    hiddenEverywhere(effective.dark, includeColor)
  );
}

function recordElements(content: string): ElementRecord[] {
  const elements: ElementRecord[] = [];
  const stack: { index: number; effective: DualEffective }[] = [];
  for (const match of content.matchAll(HTML_TAG_PATTERN)) {
    if (match[1] === '/') {
      stack.pop();
      continue;
    }
    const frames: [HidingFrame, HidingFrame] = [
      elementFrame(match[0], 'light'),
      elementFrame(match[0], 'dark'),
    ];
    const tagName = match[2].toLowerCase();
    const parentEffective =
      stack.length === 0 ? null : stack[stack.length - 1].effective;
    const effective = dualEffective(parentEffective, frames);
    // Source classes never participate in picture resource selection,
    // so a source drops only with a hiding ancestor — never for its
    // own hiding classes, which select nothing away.
    const selfEffective =
      tagName === 'source'
        ? (parentEffective ?? visibleDualEffective())
        : effective;
    const index = elements.length;
    elements.push({
      parent: stack.length === 0 ? -1 : stack[stack.length - 1].index,
      frames,
      tagName,
      hiddenNoColor: hiddenEverywhereBoth(selfEffective, false),
      hiddenWithColor: hiddenEverywhereBoth(selfEffective, true),
    });
    if (!VOID_HTML_ELEMENTS.has(tagName)) stack.push({ index, effective });
  }
  return elements;
}

export function stripHiddenContent(content: string): string {
  const elements = recordElements(content);
  // Bottom-up: parents always record before their children, so
  // reverse order decides children first. An element drops when it
  // hides at every point and no element child survives; void
  // elements never consult the color channel.
  const childrenOf = new Map<number, number[]>();
  elements.forEach((element, index) => {
    if (element.parent === -1) return;
    const siblings = childrenOf.get(element.parent) ?? [];
    siblings.push(index);
    childrenOf.set(element.parent, siblings);
  });
  const selfDrop: boolean[] = new Array(elements.length).fill(false);
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const hidden = VOID_HTML_ELEMENTS.has(elements[index].tagName)
      ? elements[index].hiddenNoColor
      : elements[index].hiddenWithColor;
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
  // Rebuild in one walk, skipping dropped subtrees and text hidden
  // at every point. Effective hiding propagates down the open stack
  // again instead of re-scanning it per tag. Stray close tags are
  // preserved as text-adjacent markup.
  const byOpenStart = new Map<number, number>();
  let seen = 0;
  for (const match of content.matchAll(HTML_TAG_PATTERN)) {
    if (match[1] === '/') continue;
    byOpenStart.set(match.index ?? content.length, seen);
    seen += 1;
  }
  const segments: string[] = [];
  const openStack: { index: number; effective: DualEffective }[] = [];
  let position = 0;
  // Drop flags propagate from parent to child, so any dropped open
  // element implies a dropped innermost one: check the top instead of
  // re-scanning the stack per tag.
  const insideDropped = () =>
    openStack.length > 0 && finalDrop[openStack[openStack.length - 1].index];
  for (const match of content.matchAll(HTML_TAG_PATTERN)) {
    const start = match.index ?? content.length;
    const top =
      openStack.length === 0 ? null : openStack[openStack.length - 1].effective;
    if (
      !insideDropped() &&
      (top === null || !hiddenEverywhereBoth(top, true))
    ) {
      segments.push(content.slice(position, start));
    }
    position = start + match[0].length;
    if (match[1] === '/') {
      const popped = openStack.pop();
      if (
        (popped === undefined || !finalDrop[popped.index]) &&
        !insideDropped()
      ) {
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
      openStack.push({
        index,
        effective: dualEffective(top, elements[index].frames),
      });
    }
    if (!finalDrop[index] && !insideDropped()) segments.push(match[0]);
  }
  const tail =
    openStack.length === 0 ? null : openStack[openStack.length - 1].effective;
  if (
    !insideDropped() &&
    (tail === null || !hiddenEverywhereBoth(tail, true))
  ) {
    segments.push(content.slice(position));
  }
  return segments.join('');
}
