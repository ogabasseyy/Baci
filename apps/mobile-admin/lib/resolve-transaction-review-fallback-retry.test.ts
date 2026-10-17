import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTransactionReviewFallbackRetry } from './resolve-transaction-review-fallback-retry';

function missingColumnError(column: string) {
  return {
    code: 'PGRST204',
    message: `Could not find the '${column}' column of 'orders' in the schema cache`,
  };
}

describe('resolveTransactionReviewFallbackRetry', () => {
  const markUnavailableSchemaColumn = vi.fn();
  const onMissingSchemaColumn = vi.fn();
  let unavailableSchemaColumns: Set<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    unavailableSchemaColumns = new Set<string>();
  });

  function resolve(
    error: { code?: string; message?: string } | null,
    stage = 'Legacy'
  ) {
    return resolveTransactionReviewFallbackRetry({
      error,
      markUnavailableSchemaColumn,
      onMissingSchemaColumn,
      stage,
      unavailableSchemaColumns,
    });
  }

  it('marks a newly missing column and requests a retry', () => {
    expect(resolve(missingColumnError('line_id'))).toBe(true);
    expect(markUnavailableSchemaColumn).toHaveBeenCalledWith('line_id');
    expect(onMissingSchemaColumn).toHaveBeenCalledWith('line_id');
  });

  it('retries a missing offer identity column', () => {
    // offer_id ships its own stripping fallback; without a retryable
    // entry the first missing-column error would surface instead of
    // degrading to the bare selector.
    expect(resolve(missingColumnError('offer_id'))).toBe(true);
    expect(markUnavailableSchemaColumn).toHaveBeenCalledWith('offer_id');
    expect(onMissingSchemaColumn).toHaveBeenCalledWith('offer_id');
  });

  it('ignores unrelated errors without retrying', () => {
    expect(resolve({ message: 'insufficient_privilege' })).toBe(false);
    expect(resolve(null)).toBe(false);
    expect(markUnavailableSchemaColumn).not.toHaveBeenCalled();
  });

  it('skips columns that are already unavailable', () => {
    unavailableSchemaColumns.add('line_id');

    expect(resolve(missingColumnError('line_id'))).toBe(false);
    expect(markUnavailableSchemaColumn).not.toHaveBeenCalled();
  });

  it('gates discount_code_id retries by stage', () => {
    expect(resolve(missingColumnError('discount_code_id'), 'Legacy')).toBe(
      false
    );
    expect(
      resolve(
        missingColumnError('discount_code_id'),
        'LegacyNoVariantAttributes'
      )
    ).toBe(true);
    expect(
      resolve(
        missingColumnError('discount_code_id'),
        'LegacyNoProductMatchStatus'
      )
    ).toBe(true);
  });

  it('retries discount_code_id once unit costs are unavailable', () => {
    unavailableSchemaColumns.add('order_item_unit_costs');

    expect(resolve(missingColumnError('discount_code_id'), 'Legacy')).toBe(
      true
    );
  });
});
