const MAX_IMAGE_DECODE_DIMENSION = 3840;

export function clampImageDecodeDimension(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.min(MAX_IMAGE_DECODE_DIMENSION, Math.ceil(value)));
}
