import { describe, expect, it, vi } from 'vitest';
import { fetchFullTransactionReviewRows } from './fetch-transaction-review-full-fallback';

const isMissingSchemaColumn = (error: unknown, column: string) =>
  String((error as { message?: string })?.message).includes(column);

describe('fetchFullTransactionReviewRows', () => {
  it('retries with the cost-rich variant-free selector', async () => {
    const runQueryWithTaxFallback = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST204', message: 'variant_id unavailable' },
      })
      .mockResolvedValueOnce({ data: [{ id: 'order-1' }], error: null });

    const result = await fetchFullTransactionReviewRows(
      { merchantId: 'merchant-1' },
      {
        isMissingSchemaColumn: (error, column) =>
          column === 'variant_id' && isMissingSchemaColumn(error, column),
        runQueryWithTaxFallback,
      }
    );

    expect(result).toEqual({ data: [{ id: 'order-1' }], error: null });
    expect(runQueryWithTaxFallback).toHaveBeenCalledTimes(2);
    expect(
      runQueryWithTaxFallback.mock.calls[1]?.[1].selectStatement
    ).not.toContain('variant_id');
    expect(
      runQueryWithTaxFallback.mock.calls[1]?.[1].selectStatement
    ).toContain('order_item_unit_costs');
  });

  it('reports missing variant ids to the rich fallback orchestrator', async () => {
    const runQueryWithTaxFallback = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST204', message: 'variant_id unavailable' },
      })
      .mockResolvedValueOnce({
        data: [{ id: 'order-variant-callback' }],
        error: null,
      });
    const onMissingSchemaColumn = vi.fn();

    await fetchFullTransactionReviewRows(
      { merchantId: 'merchant-1' },
      {
        isMissingSchemaColumn,
        onMissingSchemaColumn,
        runQueryWithTaxFallback,
      }
    );

    expect(onMissingSchemaColumn).toHaveBeenCalledWith('variant_id');
  });

  it('composes line-id and variant-id omissions before losing cost snapshots', async () => {
    const runQueryWithTaxFallback = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST204', message: 'line_id unavailable' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST204', message: 'variant_id unavailable' },
      })
      .mockResolvedValueOnce({ data: [{ id: 'order-1b' }], error: null });

    const result = await fetchFullTransactionReviewRows(
      { merchantId: 'merchant-1' },
      { isMissingSchemaColumn, runQueryWithTaxFallback }
    );

    expect(result).toEqual({ data: [{ id: 'order-1b' }], error: null });
    expect(runQueryWithTaxFallback).toHaveBeenCalledTimes(3);
    expect(runQueryWithTaxFallback.mock.calls[1]?.[0]).toBe('FullNoLineId');
    expect(runQueryWithTaxFallback.mock.calls[2]?.[0]).toBe(
      'FullNoVariantIdNoLineId'
    );
    const selector =
      runQueryWithTaxFallback.mock.calls[2]?.[1].selectStatement ?? '';
    expect(selector).not.toContain('line_id');
    expect(selector).not.toContain('variant_id');
    expect(selector).not.toContain('product_variants');
    expect(selector).toContain('order_item_unit_costs');
  });

  it('retries the cost-rich projection without transaction dates', async () => {
    const runQueryWithTaxFallback = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST204', message: 'transaction_date unavailable' },
      })
      .mockResolvedValueOnce({ data: [{ id: 'order-1c' }], error: null });

    const result = await fetchFullTransactionReviewRows(
      {
        endDateFilter: 'transaction_date.lte.2026-08-28',
        endDateIso: '2026-08-28T23:59:59.999Z',
        merchantId: 'merchant-1',
        startDateFilter: 'transaction_date.gte.2026-08-01',
        startDateIso: '2026-08-01T00:00:00.000Z',
      },
      { isMissingSchemaColumn, runQueryWithTaxFallback }
    );

    expect(result).toEqual({ data: [{ id: 'order-1c' }], error: null });
    expect(runQueryWithTaxFallback).toHaveBeenCalledTimes(2);
    expect(runQueryWithTaxFallback.mock.calls[1]?.[0]).toBe(
      'FullNoTransactionDate'
    );
    expect(runQueryWithTaxFallback.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ includeTransactionDate: false })
    );
    expect(
      runQueryWithTaxFallback.mock.calls[1]?.[1].selectStatement
    ).not.toContain('transaction_date');
    expect(
      runQueryWithTaxFallback.mock.calls[1]?.[1].selectStatement
    ).toContain('order_item_unit_costs');
  });

  it('retries the cost-rich projection without ad tracking', async () => {
    const runQueryWithTaxFallback = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST204', message: 'ad_tracking unavailable' },
      })
      .mockResolvedValueOnce({
        data: [{ id: 'order-ad-tracking' }],
        error: null,
      });

    const result = await fetchFullTransactionReviewRows(
      { merchantId: 'merchant-1' },
      { isMissingSchemaColumn, runQueryWithTaxFallback }
    );

    expect(result).toEqual({
      data: [{ id: 'order-ad-tracking' }],
      error: null,
    });
    const selector =
      runQueryWithTaxFallback.mock.calls[1]?.[1].selectStatement ?? '';
    expect(selector).not.toContain('ad_tracking');
    expect(selector).toContain('discount_amount');
    expect(selector).toContain('tax_amount');
    expect(selector).toContain('order_item_unit_costs');
  });

  it('retries the cost-rich projection without cancellation filtering', async () => {
    const runQueryWithTaxFallback = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST204', message: 'cancelled_at unavailable' },
      })
      .mockResolvedValueOnce({
        data: [{ id: 'order-cancelled-at' }],
        error: null,
      });

    const result = await fetchFullTransactionReviewRows(
      { merchantId: 'merchant-1' },
      { isMissingSchemaColumn, runQueryWithTaxFallback }
    );

    expect(result).toEqual({
      data: [{ id: 'order-cancelled-at' }],
      error: null,
    });
    expect(runQueryWithTaxFallback.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ includeCancelledAt: false })
    );
    const selector =
      runQueryWithTaxFallback.mock.calls[1]?.[1].selectStatement ?? '';
    expect(selector).not.toContain('cancelled_at');
    expect(selector).toContain('order_item_unit_costs');
  });

  it('retries without the discount code id while keeping cost fields', async () => {
    const runQueryWithTaxFallback = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST204', message: 'discount_code_id unavailable' },
      })
      .mockResolvedValueOnce({ data: [{ id: 'order-2' }], error: null });

    const result = await fetchFullTransactionReviewRows(
      { merchantId: 'merchant-1' },
      { isMissingSchemaColumn, runQueryWithTaxFallback }
    );

    expect(result).toEqual({ data: [{ id: 'order-2' }], error: null });
    expect(runQueryWithTaxFallback.mock.calls[1]?.[0]).toBe(
      'FullNoDiscountCode'
    );
    expect(
      runQueryWithTaxFallback.mock.calls[1]?.[1].selectStatement
    ).not.toContain('discount_code_id');
    expect(
      runQueryWithTaxFallback.mock.calls[1]?.[1].selectStatement
    ).toContain('order_item_unit_costs');
  });

  it('retries the combined selector when discount code fails before variant id', async () => {
    const runQueryWithTaxFallback = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST204', message: 'discount_code_id unavailable' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'PGRST204', message: 'variant_id unavailable' },
      })
      .mockResolvedValueOnce({ data: [{ id: 'order-3' }], error: null });

    const result = await fetchFullTransactionReviewRows(
      { merchantId: 'merchant-1' },
      { isMissingSchemaColumn, runQueryWithTaxFallback }
    );

    expect(result).toEqual({ data: [{ id: 'order-3' }], error: null });
    expect(runQueryWithTaxFallback.mock.calls[1]?.[0]).toBe(
      'FullNoDiscountCode'
    );
    expect(runQueryWithTaxFallback.mock.calls[2]?.[0]).toBe(
      'FullNoVariantIdNoDiscountCode'
    );
    const selector =
      runQueryWithTaxFallback.mock.calls[2]?.[1].selectStatement ?? '';
    expect(selector).not.toContain('variant_id');
    expect(selector).not.toContain('discount_code_id');
    expect(selector).toContain('order_item_unit_costs');
  });
});
