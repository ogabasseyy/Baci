const DUPLICATE_KEY =
  /duplicate|idempoten|already(?:exists|used|processed|delivered|vended|completed|fulfilled|paid|submitted|dispatched)/;
const FALSE_VALUES = new Set(['', 'false', 'no', 'n', '0']);
const MAX_DEPTH = 6;

function isSetFlag(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    return !FALSE_VALUES.has(value.trim().toLowerCase());
  }
  return false;
}

/**
 * Whether a parsed Monnify answer carries a duplicate/idempotency field (any
 * key casing, any depth) that is set: `duplicate: true` counts, while
 * `duplicate: false` does not. Text wording is checked separately.
 */
export function hasMonnifyDuplicateFlag(answer: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH || !answer || typeof answer !== 'object') {
    return false;
  }
  if (Array.isArray(answer)) {
    return answer.some((item) => hasMonnifyDuplicateFlag(item, depth + 1));
  }
  return Object.entries(answer).some(([key, value]) => {
    const normalisedKey = key.replace(/[\s_-]/g, '').toLowerCase();
    return (
      (DUPLICATE_KEY.test(normalisedKey) &&
        (Array.isArray(value) ? value : [value]).some(isSetFlag)) ||
      hasMonnifyDuplicateFlag(value, depth + 1)
    );
  });
}
