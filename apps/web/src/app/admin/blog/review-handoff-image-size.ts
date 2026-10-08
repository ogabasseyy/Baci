// Image zero-size verdicts per evaluation point. Images hide on a
// zeroed axis alone (replaced content conforms instead of
// overflowing). Author CSS beats presentational hints, so zero
// width/height attributes apply only where no CSS winner covers a
// point.
import {
  BREAKPOINT_POINT_COUNT,
  type ColorScheme,
} from './review-handoff-breakpoints';
import {
  type AxisSizeVerdict,
  sizeLayerVerdicts,
} from './review-handoff-size-layers';

function axisCappedAt(
  verdict: AxisSizeVerdict,
  attrZero: boolean,
  point: number
): boolean {
  const zero = verdict.coveredAt[point] ? verdict.zeroAt[point] : attrZero;
  return zero || verdict.maxZeroAt[point];
}

export function imageSizeZeroAt(
  classes: readonly string[],
  widthAttrZero: boolean,
  heightAttrZero: boolean,
  scheme: ColorScheme = 'light'
): boolean[] {
  const verdicts = sizeLayerVerdicts(classes, scheme);
  const zeroAt: boolean[] = [];
  for (let point = 0; point < BREAKPOINT_POINT_COUNT; point += 1) {
    const heightCapped = axisCappedAt(verdicts.height, heightAttrZero, point);
    const widthCapped = axisCappedAt(verdicts.width, widthAttrZero, point);
    zeroAt.push(
      (heightCapped && !verdicts.height.minRescuesAt[point]) ||
        (widthCapped && !verdicts.width.minRescuesAt[point])
    );
  }
  return zeroAt;
}
