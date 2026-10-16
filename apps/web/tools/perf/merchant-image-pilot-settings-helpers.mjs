// Positive-axes viewport parser for the pilot effective-settings gate.
// Zero is not a viewport: --expect-viewport=0x0 would certify an empty
// screenshot, so both axes must be positive integers.
export function parseDimensions(value, name) {
  const match = /^(\d+)x(\d+)$/.exec(String(value ?? ''));
  const width = match ? Number(match[1]) : Number.NaN;
  const height = match ? Number(match[2]) : Number.NaN;
  if (!match || width <= 0 || height <= 0) {
    throw new Error(`bad --${name}: ${value}`);
  }
  return { height, width };
}
