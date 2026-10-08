// Ancestry hiding verdict per evaluation point: terminal hiding
// anywhere in the chain wins, else the nearest visibility marker,
// else (for glyphs only) the nearest color marker. Transparent
// color hides text but not decoded image pixels, so only the text
// path consults it; an opaque descendant escapes a transparent
// ancestor exactly like `visible` escapes `invisible`.
import { BREAKPOINT_POINT_COUNT } from './review-handoff-breakpoints';
import type { HidingFrame } from './review-handoff-element-frame';

export function subtreeHiddenAt(
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
