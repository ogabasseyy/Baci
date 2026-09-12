/** FOCUS EffectiveCost may be negative for credits/corrections. */
export function finiteSigned(value: unknown, field: string) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.abs(value) > Number.MAX_SAFE_INTEGER
  )
    throw new Error(`billing row has an invalid ${field}`);
  return value;
}
