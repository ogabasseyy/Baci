// Sharp metadata interpreters for the encode worker: container disambiguation
// (HEIF/AVIF) and EXIF-oriented dimensions. Pure functions split from
// encode-worker.mjs under the repo line ceiling.

// Sharp/libvips reports the shared HEIF container as `heif` for both input
// and output bytes. Only AV1-coded stills are AVIF: HEVC-coded HEIC stills
// and unknown compressions stay `heif` so the format gates reject them.
export function normalizeFormat(meta) {
  if (meta?.format === 'heif' && meta?.compression === 'av1') {
    return 'avif';
  }
  return meta?.format;
}

export function orientedDimensions(meta) {
  const orientation = meta.orientation ?? 1;
  if (orientation >= 5 && orientation <= 8) {
    return { height: meta.width, width: meta.height };
  }
  return { height: meta.height, width: meta.width };
}
