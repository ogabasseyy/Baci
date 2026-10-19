// Inspection-raster sizing for the pilot quality sheet, split from
// quality-sheet-render.mjs under the repo line ceiling.
//
// A review raster must carry at least the pixels the mounted browser
// candidate needs for its visible crop — not just cssWidth * dpr.
// For an `object-fit: cover` mount whose box aspect differs from the
// decoded source aspect, only a fraction of the source width stays
// visible: a 4:1 logo in the canonical 1:1 header box shows 1/4 of
// its width, so a 40px raster would let CSS enlarge 10 source pixels
// across the 40px box while the storefront samples ~160. The sheet
// would then certify a blurrier image than the mount shows and can
// produce an invalid visual verdict.
//
// desiredInspectionWidth derives the needed width from BOTH aspects
// before the caller applies the candidate-width cap (never upscale):
// contain mounts and intrinsic renders need no boost (the whole
// frame stays visible), and tall sources in wide boxes need none
// either (CSS crops the height, the width is already exact).
export function desiredInspectionWidth(
  cssWidth,
  dpr,
  srcWidth,
  srcHeight,
  crop
) {
  const base = cssWidth * dpr;
  if (
    crop?.fit !== 'cover' ||
    !(srcWidth > 0) ||
    !(srcHeight > 0) ||
    !(crop.boxAspect > 0)
  ) {
    return base;
  }
  // Visible width fraction under cover: a box narrower (in aspect)
  // than the source keeps boxAspect/srcAspect of the frame.
  const visible = Math.min(1, crop.boxAspect / (srcWidth / srcHeight));
  if (!(visible > 0)) {
    return base;
  }
  return Math.ceil(base / visible);
}
