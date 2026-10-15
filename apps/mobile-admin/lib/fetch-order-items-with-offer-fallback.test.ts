import { describe, expect, it, vi } from 'vitest';
import {
  fetchOrderItemsWithOfferFallback,
  stripMissingOrderOfferColumns,
} from './fetch-order-items-with-offer-fallback';

const COLUMNS =
  'id, product_id, offer_id, offer_grade, offer_condition_notes, offer_labels_snapshotted';

function schemaCacheError(column: string) {
  return {
    code: 'PGRST204',
    message: `Could not find the '${column}' column of 'order_items' in the schema cache`,
  };
}

describe('stripMissingOrderOfferColumns', () => {
  it('drops exactly the missing offer columns', () => {
    expect(
      stripMissingOrderOfferColumns(COLUMNS, [
        'offer_grade',
        'offer_labels_snapshotted',
      ])
    ).toBe('id,product_id,offer_id,offer_condition_notes');
  });

  it('returns the selector untouched when nothing is missing', () => {
    expect(stripMissingOrderOfferColumns(COLUMNS, [])).toBe(COLUMNS);
  });

  it('preserves embedded relation fragments while stripping', () => {
    expect(
      stripMissingOrderOfferColumns(
        `${COLUMNS}, products(name, images, condition)`,
        ['offer_id']
      )
    ).toBe(
      'id,product_id,offer_grade,offer_condition_notes,offer_labels_snapshotted,products(name,images,condition)'
    );
  });
});

describe('fetchOrderItemsWithOfferFallback', () => {
  it('returns the first result when the query succeeds', async () => {
    const run = vi.fn(async () => ({ data: [{ id: '1' }], error: null }));
    const result = await fetchOrderItemsWithOfferFallback(run, COLUMNS);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(COLUMNS);
    expect(result.data).toEqual([{ id: '1' }]);
  });

  it('retries without the missing offer columns on schema drift', async () => {
    const run = vi
      .fn<
        (columns: string) => Promise<{
          data: unknown;
          error: { code: string; message: string } | null;
        }>
      >()
      .mockResolvedValueOnce({
        data: null,
        error: schemaCacheError('offer_labels_snapshotted'),
      })
      .mockResolvedValueOnce({ data: [{ id: '1' }], error: null });

    const result = await fetchOrderItemsWithOfferFallback(run, COLUMNS);

    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(
      2,
      'id,product_id,offer_id,offer_grade,offer_condition_notes'
    );
    expect(result.data).toEqual([{ id: '1' }]);
  });

  it('does not retry non-schema errors', async () => {
    const run = vi.fn(async () => ({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    }));

    const result = await fetchOrderItemsWithOfferFallback(run, COLUMNS);

    expect(run).toHaveBeenCalledTimes(1);
    expect(result.error).toMatchObject({ code: '42501' });
  });

  it('does not retry drift in columns outside the offer set', async () => {
    const run = vi.fn(async () => ({
      data: null,
      error: schemaCacheError('variant_attributes'),
    }));

    const result = await fetchOrderItemsWithOfferFallback(run, COLUMNS);

    expect(run).toHaveBeenCalledTimes(1);
    expect(result.error).toMatchObject({ code: 'PGRST204' });
  });
});
