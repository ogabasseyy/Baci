// Incremental ancestry hiding verdicts per evaluation point:
// terminal hiding anywhere in the chain wins, else the nearest
// visibility marker, else (for glyphs only) the nearest color
// marker. Transparent color hides text but not decoded image
// pixels, so only the text path consults it; an opaque descendant
// escapes a transparent ancestor exactly like `visible` escapes
// `invisible`. Each push combines one frame with its parent in
// O(points), so deep articles evaluate in linear time instead of
// re-scanning the ancestor chain per tag.
import { BREAKPOINT_POINT_COUNT } from './review-handoff-breakpoints';
import type { HidingFrame } from './review-handoff-element-frame';
import type {
  ColorAtPoint,
  VisibilityAtPoint,
} from './review-handoff-showing-markers';

type EffectiveLevel = {
  colorAt: ColorAtPoint[];
  terminalAt: boolean[];
  visibilityAt: VisibilityAtPoint[];
};

export class HidingStack {
  private readonly levels: EffectiveLevel[] = [];

  push(frame: HidingFrame): void {
    const parent =
      this.levels.length === 0 ? null : this.levels[this.levels.length - 1];
    const colorAt: ColorAtPoint[] = [];
    const terminalAt: boolean[] = [];
    const visibilityAt: VisibilityAtPoint[] = [];
    for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
      terminalAt.push(
        (parent?.terminalAt[point] ?? false) || frame.terminalAt[point]
      );
      visibilityAt.push(
        frame.visibilityAt[point] ?? parent?.visibilityAt[point] ?? null
      );
      colorAt.push(frame.colorAt[point] ?? parent?.colorAt[point] ?? null);
    }
    this.levels.push({ colorAt, terminalAt, visibilityAt });
  }

  pop(): void {
    this.levels.pop();
  }

  hiddenAt(includeColor: boolean): boolean[] {
    const top =
      this.levels.length === 0 ? null : this.levels[this.levels.length - 1];
    const hiddenAt: boolean[] = [];
    for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
      if (top?.terminalAt[point]) {
        hiddenAt.push(true);
        continue;
      }
      if (top?.visibilityAt[point] === 'invisible') {
        hiddenAt.push(true);
        continue;
      }
      if (includeColor && top?.colorAt[point] === 'transparent') {
        hiddenAt.push(true);
        continue;
      }
      hiddenAt.push(false);
    }
    return hiddenAt;
  }
}
