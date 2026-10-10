import { z } from 'zod';

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : Number.NaN;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return value;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }

  return value;
}

export const NumberLikeSchema = z.preprocess(toFiniteNumber, z.number());
export const NullableNumberLikeSchema = z.preprocess(
  (value) => (value === null ? null : toFiniteNumber(value)),
  z.number().nullable()
);
export const NullableNonnegativeIntegerLikeSchema = z.preprocess(
  (value) => (value === null ? null : toFiniteNumber(value)),
  z.number().int().nonnegative().nullable()
);
