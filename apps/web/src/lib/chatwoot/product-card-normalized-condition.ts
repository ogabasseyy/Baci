import { normalizeCanonicalProductCondition } from '@baci/shared/lib';

const ALLOWED_CONDITIONS = new Set(['new', 'used', 'open_box']);

export function normalizedCondition(
  value: unknown
): 'new' | 'used' | 'open_box' | undefined {
  if (typeof value !== 'string') return undefined;
  const condition = normalizeCanonicalProductCondition(value);
  return ALLOWED_CONDITIONS.has(condition)
    ? (condition as 'new' | 'used' | 'open_box')
    : undefined;
}
