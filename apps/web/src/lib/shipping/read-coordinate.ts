type CoordinateReading =
  | { status: 'absent' | 'invalid' }
  | { status: 'valid'; value: number };

export function readCoordinate(
  value: unknown,
  minimum: number,
  maximum: number
): CoordinateReading {
  if (value === null || value === undefined) return { status: 'absent' };
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value.trim())
        : undefined;
  if (
    numericValue === undefined ||
    !Number.isFinite(numericValue) ||
    numericValue < minimum ||
    numericValue > maximum
  ) {
    return { status: 'invalid' };
  }
  return { status: 'valid', value: numericValue };
}
