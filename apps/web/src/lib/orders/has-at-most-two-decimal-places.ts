// Exact decimal-place count off the shortest round-trip text: a
// float epsilon on value*100 breaks past ~1e8 (the product's ULP
// exceeds 1e-6), while the repr preserves the JSON author's
// intended decimals at any magnitude. Exponent forms expand to
// their true places, so whole-naira magnitudes stay valid.
// Shared by the server schema and the client pre-validator so the
// two can never disagree about an amount's shape.
export function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const m = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(value));
  if (!m) return false;
  const fracLen = m[2]?.length ?? 0;
  const exp = m[3] === undefined ? 0 : Number.parseInt(m[3], 10);
  return fracLen - exp <= 2;
}
