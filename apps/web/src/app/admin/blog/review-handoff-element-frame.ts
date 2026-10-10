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

function classTokens(element: Element): string[] | null {
  // A missing class attribute yields no markers; a present one
  // splits exactly as the raw attribute text did, so padded values
  // behave identically.
  const value = element.getAttribute('class');
  return value === null ? null : value.split(/\s+/);
}

function tagTerminalAt(element: Element, scheme: ColorScheme): boolean[] {
  // The sanitizer preserves class but strips style, so hidden subtrees
  // arrive only as Tailwind tokens.
  const terminalAt = new Array<boolean>(BREAKPOINT_POINT_COUNT).fill(false);
  const tokens = classTokens(element);
  if (tokens === null) return terminalAt;
  const markers = showingMarkers(tokens, scheme);
  for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
    terminalAt[point] = terminalAt[point] || markers.terminalAt[point];
  }
  return terminalAt;
}

function elementVisibilityAt(
  element: Element,
  scheme: ColorScheme
): VisibilityAtPoint[] {
  const tokens = classTokens(element);
  if (tokens === null) return nullVisibilityAt();
  // A pathological element carrying both markers resolves per
  // point to the latest applicable winner. Content shown at any
  // point is readable.
  return showingMarkers(tokens, scheme).visibilityAt;
}

function elementColorAt(element: Element, scheme: ColorScheme): ColorAtPoint[] {
  const tokens = classTokens(element);
  if (tokens === null) return nullColorAt();
  // Same-layer color conflicts resolve by generated precedence
  // (naturally last wins), so a transparent winner beats
  // text-black while text-white beats transparent. current/inherit
  // winners pass through to the ancestor frames. A background
  // clipped to the glyphs renders transparent text like opaque.
  return showingMarkers(tokens, scheme).colorAt;
}

export function elementFrame(
  element: Element,
  scheme: ColorScheme = 'light'
): HidingFrame {
  return {
    terminalAt: tagTerminalAt(element, scheme),
    visibilityAt: elementVisibilityAt(element, scheme),
    colorAt: elementColorAt(element, scheme),
  };
}
