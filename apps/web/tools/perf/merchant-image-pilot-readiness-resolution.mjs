// Resolution-sufficiency verdict for the readiness gate: compares the
// rendered box at profile DPR against physical resource pixels
// (density-corrected for w-descriptor srcsets). Split from the checks
// module (merchant-image-pilot-readiness-checks.mjs) under the repo line ceiling.

// Physical resource pixels: with a w-descriptor srcset the browser
// density-corrects naturalWidth (resource pixels / selected density), so
// a correctly provisioned 768w resource for a 384px box at DPR 2 reports
// naturalWidth ~384 — comparing THAT against box*DPR would reject a good
// image. The collected w-descriptor carries the physical width; height
// follows from the natural aspect (correction preserves aspect).
// Plain-src images report no descriptor and keep natural pixels.
function physicalPixels(image) {
  const naturalWidth = image.naturalWidth ?? 0;
  const naturalHeight = image.naturalHeight ?? 0;
  const descriptor =
    Number.isFinite(image.resourceWidth) && image.resourceWidth > 0
      ? image.resourceWidth
      : null;
  if (descriptor === null) {
    return { descriptor: null, height: naturalHeight, width: naturalWidth };
  }
  const aspect = naturalWidth > 0 ? naturalHeight / naturalWidth : 0;
  return {
    descriptor,
    height: Math.round(descriptor * aspect),
    width: descriptor,
  };
}

// Resolution sufficiency: a decoded image can still be under-resolved
// for its rendered box and profile DPR (e.g. a 928px-capped source
// passing a 412px/DPR-3 profile whose 100vw card needs ~1236px). The
// browser must not upscale past the physical pixels: cover/fill need
// both axes (AND), contain needs the constraining axis (OR) —
// min(box/phys) <= 1/dpr is exactly physW >= needW || physH >= needH.
export function resolutionProblems(image, label, dpr) {
  const box = image.box ?? {};
  const naturalHeight = image.naturalHeight ?? 0;
  if (
    !Number.isFinite(dpr) ||
    dpr <= 0 ||
    !Number.isFinite(box.width) ||
    !Number.isFinite(box.height) ||
    naturalHeight < 1 ||
    typeof image.objectFit !== 'string'
  ) {
    return [`${label} resolution unverifiable (missing collection data)`];
  }
  if (box.width < 1 || box.height < 1) {
    return [`${label} has no measurable box`];
  }
  const physical = physicalPixels(image);
  const needWidth = Math.round(box.width * dpr);
  const needHeight = Math.round(box.height * dpr);
  const sufficient =
    image.objectFit === 'contain'
      ? physical.width >= needWidth || physical.height >= needHeight
      : physical.width >= needWidth && physical.height >= needHeight;
  if (sufficient) {
    return [];
  }
  const provenance =
    physical.descriptor === null ? '' : ` (resource ${physical.descriptor}w)`;
  return [
    `${label} under-resolved: ${physical.width}x${physical.height}px${provenance} serves a ${Math.round(box.width)}x${Math.round(box.height)}px box at DPR ${dpr} (needs ${needWidth}x${needHeight}px for ${image.objectFit})`,
  ];
}
