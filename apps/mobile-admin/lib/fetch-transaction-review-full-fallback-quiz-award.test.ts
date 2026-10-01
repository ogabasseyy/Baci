import { describe, expect, it, vi } from 'vitest';
import { fetchFullTransactionReviewRows } from './fetch-transaction-review-full-fallback';

const isMissingSchemaColumn = (error: unknown, column: string) =>
  String((error as { message?: string })?.message).includes(column);

describe('fetchFullTransactionReviewRows quiz award fallbacks', () => {
  it('retries without quiz award amounts while retaining the rich projection', async () => {
    const runQueryWithTaxFallback = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST204', message: 'quiz_award_amount unavailable' },
      })
      .mockResolvedValueOnce({
        data: [{ id: 'order-quiz-award-amount' }],
        error: null,
      });
    const onMissingSchemaColumn = vi.fn();

    const result = await fetchFullTransactionReviewRows(
      { merchantId: 'merchant-1' },
      {
        isMissingSchemaColumn,
        onMissingSchemaColumn,
        runQueryWithTaxFallback,
      }
    );

    expect(result).toEqual({
      data: [{ id: 'order-quiz-award-amount' }],
      error: null,
    });
    expect(runQueryWithTaxFallback).toHaveBeenCalledTimes(2);
    expect(onMissingSchemaColumn).toHaveBeenCalledWith('quiz_award_amount');
    expect(
      runQueryWithTaxFallback.mock.calls[1]?.[1].selectStatement
    ).not.toContain('quiz_award_amount');
    expect(
      runQueryWithTaxFallback.mock.calls[1]?.[1].selectStatement
    ).toContain('order_item_unit_costs');
  });

  it('composes quiz omission with a later variant id fallback', async () => {
    const runQueryWithTaxFallback = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST204', message: 'quiz_award_id unavailable' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST204', message: 'variant_id unavailable' },
      })
      .mockResolvedValueOnce({
        data: [{ id: 'order-quiz-variant' }],
        error: null,
      });

    const result = await fetchFullTransactionReviewRows(
      { merchantId: 'merchant-1' },
      { isMissingSchemaColumn, runQueryWithTaxFallback }
    );

    expect(result).toEqual({
      data: [{ id: 'order-quiz-variant' }],
      error: null,
    });
    expect(runQueryWithTaxFallback).toHaveBeenCalledTimes(3);
    expect(runQueryWithTaxFallback.mock.calls[1]?.[0]).toBe(
      'FullNoQuizAwardId'
    );
    expect(runQueryWithTaxFallback.mock.calls[2]?.[0]).toBe(
      'FullNoVariantIdNoQuizAwardId'
    );
    const selector =
      runQueryWithTaxFallback.mock.calls[2]?.[1].selectStatement ?? '';
    expect(selector).not.toContain('quiz_award_id');
    expect(selector).not.toContain('variant_id');
    expect(selector).not.toContain('product_variants');
    expect(selector).toContain('order_item_unit_costs');
  });
});
