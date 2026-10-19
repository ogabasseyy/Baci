import type {
  RedvaultRefundResult,
  RedvaultStoredNetAllocation,
} from '../contracts/redvault-quote';

function requireSafeNonnegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${name} must be a nonnegative safe integer`);
  }
  return value as number;
}

export function allocateRedvaultRefund(
  allocation: RedvaultStoredNetAllocation,
  returnedUnitIndexes: readonly number[]
): RedvaultRefundResult {
  if (
    !allocation ||
    typeof allocation.itemId !== 'string' ||
    !allocation.itemId.trim()
  ) {
    throw new Error('itemId must be a non-empty string');
  }
  if (
    !Array.isArray(allocation.unitNetAmountsKobo) ||
    !Array.isArray(returnedUnitIndexes)
  ) {
    throw new Error('unit allocations and returned indexes must be arrays');
  }
  const seen = new Set<number>();
  const unitNetAmountsKobo = returnedUnitIndexes.map((index) => {
    const validIndex = requireSafeNonnegativeInteger(
      index,
      'returned unit index'
    );
    if (validIndex >= allocation.unitNetAmountsKobo.length) {
      throw new Error('returned unit index is outside the allocation range');
    }
    if (seen.has(validIndex)) {
      throw new Error('returned unit indexes must be unique');
    }
    seen.add(validIndex);
    return requireSafeNonnegativeInteger(
      allocation.unitNetAmountsKobo[validIndex],
      'stored net unit amount'
    );
  });
  const refundKobo = unitNetAmountsKobo.reduce((total, amount) => {
    if (amount > Number.MAX_SAFE_INTEGER - total) {
      throw new Error('refund overflow');
    }
    return total + amount;
  }, 0);
  return { refundKobo, unitNetAmountsKobo };
}
