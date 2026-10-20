import {
  type CanonicalProductCondition,
  normalizeCanonicalProductCondition,
} from '@baci/shared/lib';

const VALID_CONDITIONS = new Set<CanonicalProductCondition>([
  'new',
  'used',
  'open_box',
]);

export type ProductCondition = CanonicalProductCondition;

export function getValidConditionOptions(values: string[]) {
  return values
    .map((value) => normalizeCanonicalProductCondition(value))
    .filter(
      (value): value is ProductCondition =>
        value !== '' && VALID_CONDITIONS.has(value)
    );
}
