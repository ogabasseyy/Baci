// One element's hiding frame: same-element terminal markers plus
// the inherited visibility and color winners for the ancestry
// walk. Display, opacity, and clipping never escape an affected
// ancestor, so terminal markers apply same-element only; a
// responsive override on the same element (`hidden md:block`)
// renders at the points it covers. `invisible` and
// `text-transparent` are tracked as markers instead: visibility
// and color inherit, so a descendant `visible` or opaque text
// color overrides them.
import {
  BREAKPOINT_POINT_COUNT,
  type ColorScheme,
} from './review-handoff-breakpoints';
import {
  type ColorAtPoint,
  showingMarkers,
  type VisibilityAtPoint,
} from './review-handoff-showing-markers';
import { tagAttributes } from './review-handoff-tag-attributes';

export type HidingFrame = {
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

function tagTerminalAt(tag: string, scheme: ColorScheme): boolean[] {
  // The sanitizer preserves class but strips style, so hidden subtrees
  // arrive only as Tailwind tokens.
  const terminalAt = new Array<boolean>(BREAKPOINT_POINT_COUNT).fill(false);
  for (const { name, value } of tagAttributes(tag)) {
    if (name !== 'class') continue;
    const markers = showingMarkers(value.split(/\s+/), scheme);
    for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
      terminalAt[point] = terminalAt[point] || markers.terminalAt[point];
    }
  }
  return terminalAt;
}

function elementVisibilityAt(
  tag: string,
  scheme: ColorScheme
): VisibilityAtPoint[] {
  for (const { name, value } of tagAttributes(tag)) {
    if (name !== 'class') continue;
    // A pathological element carrying both markers resolves per
    // point to the latest applicable winner. Content shown at any
    // point is readable.
    return showingMarkers(value.split(/\s+/), scheme).visibilityAt;
  }
  return nullVisibilityAt();
}

function elementColorAt(tag: string, scheme: ColorScheme): ColorAtPoint[] {
  for (const { name, value } of tagAttributes(tag)) {
    if (name !== 'class') continue;
    // Same-layer color conflicts resolve by generated precedence
    // (naturally last wins), so a transparent winner beats
    // text-black while text-white beats transparent. current/inherit
    // winners pass through to the ancestor frames. A background
    // clipped to the glyphs renders transparent text like opaque.
    return showingMarkers(value.split(/\s+/), scheme).colorAt;
  }
  return nullColorAt();
}

export function elementFrame(
  tag: string,
  scheme: ColorScheme = 'light'
): HidingFrame {
  return {
    terminalAt: tagTerminalAt(tag, scheme),
    visibilityAt: elementVisibilityAt(tag, scheme),
    colorAt: elementColorAt(tag, scheme),
  };
}
