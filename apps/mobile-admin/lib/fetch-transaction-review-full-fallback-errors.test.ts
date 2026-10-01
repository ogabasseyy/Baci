import { describe, expect, it, vi } from 'vitest';
import { fetchFullTransactionReviewRows } from './fetch-transaction-review-full-fallback';

const isMissingSchemaColumn = (error: unknown, column: string) =>
  String((error as { message?: string })?.message).includes(column);

describe('fetchFullTransactionReviewRows errors', () => {
  it('returns the final schema error when every full projection fails', async () => {
    const finalError = {
      code: 'PGRST204',
      message: 'unexpected schema cache failure',
    };
    const runQueryWithTaxFallback = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST204', message: 'discount_code_id unavailable' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST204', message: 'discount_amount unavailable' },
      })
      .mockResolvedValueOnce({ data: null, error: finalError });

    const result = await fetchFullTransactionReviewRows(
      { merchantId: 'merchant-1' },
      { isMissingSchemaColumn, runQueryWithTaxFallback }
    );

    expect(result).toEqual({ data: null, error: finalError });
  });
});
