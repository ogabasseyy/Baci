import type { ShipmentItem } from './types';

export type PackageDimensionsCm = Pick<
  ShipmentItem,
  'length' | 'width' | 'height'
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readPositiveNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
    ? parsed
    : undefined;
}

function normalizeDimensionCm(
  value: unknown,
  unit: string | undefined
): number | undefined {
  const dimension = readPositiveNumber(value);
  if (!dimension) return undefined;

  const multiplier = { in: 2.54, m: 100, mm: 0.1 }[unit?.toLowerCase() ?? ''];
  return dimension * (multiplier ?? 1);
}

/** Normalize product package dimensions to centimeters for quote/booking items. */
export function readPackageDimensionsCm(
  dimensions: unknown
): PackageDimensionsCm | undefined {
  if (!isRecord(dimensions)) return undefined;

  const unit =
    typeof dimensions.unit === 'string' ? dimensions.unit : undefined;
  const length = normalizeDimensionCm(
    dimensions.length ?? dimensions.depth,
    unit
  );
  const width = normalizeDimensionCm(dimensions.width, unit);
  const height = normalizeDimensionCm(dimensions.height, unit);

  return length && width && height ? { length, width, height } : undefined;
}
