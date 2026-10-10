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
import { BREAKPOINT_POINT_COUNT } from './review-handoff-breakpoints';
import { parseHandoffDom } from './review-handoff-dom';
import { elementFrame, type HidingFrame } from './review-handoff-element-frame';
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

type DualEffective = {
  light: EffectiveHiding;
  dark: EffectiveHiding;
};

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

function visibleDualEffective(): DualEffective {
  // A parentless source evaluates visible: nothing above it can
  // hide it, and its own frame never applies.
  const visible = (): EffectiveHiding => ({
    color: new Array<ColorAtPoint>(BREAKPOINT_POINT_COUNT).fill(null),
    terminal: new Array<boolean>(BREAKPOINT_POINT_COUNT).fill(false),
    visibility: new Array<VisibilityAtPoint>(BREAKPOINT_POINT_COUNT).fill(null),
  });
  return { dark: visible(), light: visible() };
}

function dualEffectiveOf(
  element: Element,
  schemeFrames: Map<Element, DualEffective>
): DualEffective {
  // Memoized root-down evaluation: an element combines its own
  // frames with its parent's effective state. Source classes never
  // participate in picture resource selection, so a source drops
  // only with a hiding ancestor — never for its own hiding classes,
  // which select nothing away. Iterative: pathological nesting
  // would overflow a recursive climb.
  const chain: Element[] = [];
  let current: Element | null = element;
  while (current !== null && !schemeFrames.has(current)) {
    chain.unshift(current);
    current = current.parentElement;
  }
  let parentEffective =
    current === null ? null : (schemeFrames.get(current) ?? null);
  for (const item of chain) {
    let effective: DualEffective;
    if (item.tagName.toLowerCase() === 'source') {
      effective = parentEffective ?? visibleDualEffective();
    } else {
      const frames: [HidingFrame, HidingFrame] = [
        elementFrame(item, 'light'),
        elementFrame(item, 'dark'),
      ];
      effective = {
        light: combineEffective(parentEffective?.light ?? null, frames[0]),
        dark: combineEffective(parentEffective?.dark ?? null, frames[1]),
      };
    }
    schemeFrames.set(item, effective);
    parentEffective = effective;
  }
  const resolved = schemeFrames.get(element);
  if (!resolved) throw new Error('strip evaluation missed its element');
  return resolved;
}

export function stripHiddenContent(content: string): string {
  const doc = parseHandoffDom(content);
  const schemeFrames = new Map<Element, DualEffective>();
  // Bottom-up: document order lists parents before children, so
  // reverse order decides children first. An element drops when it
  // hides at every point and no element child survives; void
  // elements never consult the color channel.
  const elements = [...doc.querySelectorAll('body *')];
  const selfDrop = new Map<Element, boolean>();
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];
    const tagName = element.tagName.toLowerCase();
    const hidden = hiddenEverywhereBoth(
      dualEffectiveOf(element, schemeFrames),
      !VOID_HTML_ELEMENTS.has(tagName)
    );
    const childrenDrop = [...element.children].every(
      (child) => selfDrop.get(child) ?? false
    );
    selfDrop.set(element, hidden && childrenDrop);
  }
  for (const element of elements) {
    if (selfDrop.get(element) === true) element.remove();
  }
  // Text hidden at every point drops even under a kept ancestor
  // whose escaping child must stay.
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node !== null) {
    const parent = node.parentElement;
    if (
      parent !== null &&
      hiddenEverywhereBoth(dualEffectiveOf(parent, schemeFrames), true)
    ) {
      const current = node;
      node = walker.nextNode();
      parent.removeChild(current);
    } else {
      node = walker.nextNode();
    }
  }
  return doc.body.innerHTML;
}
