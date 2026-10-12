// Per-breakpoint size and clipping markers: a zeroed axis alone
// still overflows visibly, so callers pair zero markers with
// same-axis clipping. Combines the shared layer verdicts: a nonzero
// minimum beats any zero, otherwise a zero height/width or zero
// maximum zeroes the axis.
import {
  BREAKPOINT_POINT_COUNT,
  type ColorScheme,
} from './review-handoff-breakpoints';
import { sizeLayerVerdicts } from './review-handoff-size-layers';

function axisZeroAt(
  zeroAt: readonly boolean[],
  maxZeroAt: readonly boolean[],
  minRescuesAt: readonly boolean[],
  point: number
): boolean {
  if (minRescuesAt[point]) return false;
  return zeroAt[point] || maxZeroAt[point];
}

export function sizeMarkers(
  classes: readonly string[],
  scheme: ColorScheme = 'light'
): {
  heightZeroAt: boolean[];
  widthZeroAt: boolean[];
  clipsXAt: boolean[];
  clipsYAt: boolean[];
} {
  const verdicts = sizeLayerVerdicts(classes, scheme);
  const heightZeroAt: boolean[] = [];
  const widthZeroAt: boolean[] = [];
  for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
    heightZeroAt.push(
      axisZeroAt(
        verdicts.height.zeroAt,
        verdicts.height.maxZeroAt,
        verdicts.height.minRescuesAt,
        point
      )
    );
    widthZeroAt.push(
      axisZeroAt(
        verdicts.width.zeroAt,
        verdicts.width.maxZeroAt,
        verdicts.width.minRescuesAt,
        point
      )
    );
  }
  return {
    heightZeroAt,
    widthZeroAt,
    clipsXAt: verdicts.clipsXAt,
    clipsYAt: verdicts.clipsYAt,
  };
}
