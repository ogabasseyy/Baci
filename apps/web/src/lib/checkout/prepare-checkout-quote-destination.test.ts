import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderQuoteDestinationMismatchError } from '@/lib/shipping/order-quote-destination-errors';
import { CanonicalOrderSubtotalLoadError } from './canonical-order-subtotal';
import { prepareCheckoutQuoteDestination } from './prepare-checkout-quote-destination';

const mocks = vi.hoisted(() => ({
  enrich: vi.fn(),
  replay: vi.fn(),
  convert: vi.fn(),
}));
vi.mock('@/lib/shipping/order-quote-destination', async () => ({
  ...(await vi.importActual('@/lib/shipping/order-quote-destination')),
  enrichShippingAddressWithQuoteDestination: mocks.enrich,
}));
vi.mock('./has-existing-keyed-order', () => ({
  hasExistingKeyedOrder: mocks.replay,
}));
vi.mock('@/lib/shipping/international-shipment-items', () => ({
  toInternationalQuoteValidationItemsFromOrder: mocks.convert,
}));
const address = {
  country: undefined,
  countryCode: undefined,
  postalCode: undefined,
  address: '12 Airport Road',
  city: 'Ikeja',
  state: 'Lagos',
};
function input() {
  const result = {
    data: [{ id: 'product', name: 'Item' }],
    error: null as { code: string } | null,
  };
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    returns: vi.fn(async () => result),
  };
  const from = vi.fn(() => query);
  return {
    result,
    from,
    query,
    params: {
      isIdempotentLocalAirportReplay: false,
      isIdempotentOrderReplay: false,
      items: [{ product_id: 'product', quantity: 1, price: 100 }],
      merchantId: 'merchant',
      requestIdempotencyKey: 'key',
      selectedQuoteId: 'quote' as string | null,
      shippingAddress: address,
      shippingFee: 100,
      shippingProvider: null as string | null,
      supabase: { from } as unknown as SupabaseClient,
    },
  };
}
describe('prepareCheckoutQuoteDestination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.replay.mockResolvedValue(false);
    mocks.convert.mockReturnValue([{ name: 'Item', quantity: 1, value: 100 }]);
    mocks.enrich.mockImplementation(
      async (_client, _quote, destination, context) => {
        context.onValidatedQuoteProvider('GIGL');
        return { ...destination, latitude: 6, longitude: 3 };
      }
    );
  });
  it('returns the single lookup callback carrier and destination with merchant-scoped item validation', async () => {
    const { params, query, from } = input();
    await expect(prepareCheckoutQuoteDestination(params)).resolves.toEqual({
      ok: true,
      shippingAddress: { ...address, latitude: 6, longitude: 3 },
      validatedQuoteProvider: 'GIGL',
    });
    expect(from).toHaveBeenCalledOnce();
    expect(query.eq).toHaveBeenCalledWith('merchant_id', 'merchant');
    expect(mocks.enrich).toHaveBeenCalledOnce();
    expect(mocks.enrich).toHaveBeenCalledWith(
      params.supabase,
      'quote',
      address,
      expect.objectContaining({
        isNewOrder: true,
        isConfirmedReplay: false,
        shippingFee: 100,
        shippingProvider: null,
        merchantId: 'merchant',
        items: [{ name: 'Item', quantity: 1, value: 100 }],
      }),
      { persistAttestedCoordinates: true }
    );
  });
  it('bills the live offer price for uppercase caller spellings', async () => {
    const { params, result } = input();
    result.data = [{ id: 'PROD', name: 'Phone' }];
    await prepareCheckoutQuoteDestination({
      ...params,
      items: [
        {
          product_id: 'PROD',
          offer_id: 'OFFER',
          quantity: 1,
          price: 999,
        },
      ],
      offerPrices: new Map([['prod::offer', 400]]),
    });
    // The live basis wins over the stale submitted price only when
    // the canonical key meets the lowercase live map.
    expect(mocks.convert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ price: 400, quantity: 1 }),
      ]),
      { includeValue: true }
    );
  });

  it('reproduces new-order shape on confirmed retries without bypassing fee/provider validation', async () => {
    const { params } = input();
    mocks.replay.mockResolvedValue(true);
    await prepareCheckoutQuoteDestination({
      ...params,
      isIdempotentOrderReplay: true,
      shippingProvider: 'GIGL',
    });
    expect(mocks.enrich).toHaveBeenCalledWith(
      params.supabase,
      'quote',
      address,
      expect.objectContaining({
        isNewOrder: true,
        isConfirmedReplay: true,
        shippingFee: 100,
        shippingProvider: 'GIGL',
      }),
      { persistAttestedCoordinates: false }
    );
  });
  it('treats a confirmed airport replay as a quote replay without a new keyed replay probe', async () => {
    const { params } = input();
    await prepareCheckoutQuoteDestination({
      ...params,
      isIdempotentLocalAirportReplay: true,
    });
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(mocks.enrich).toHaveBeenCalledWith(
      params.supabase,
      'quote',
      address,
      expect.objectContaining({
        isConfirmedReplay: true,
        shippingFee: 100,
        shippingProvider: null,
      }),
      { persistAttestedCoordinates: false }
    );
  });
  it('keeps legacy metadata-free replay context if the keyed precheck cannot confirm it', async () => {
    const { params } = input();
    await prepareCheckoutQuoteDestination({
      ...params,
      isIdempotentOrderReplay: true,
    });
    expect(mocks.enrich).toHaveBeenCalledWith(
      params.supabase,
      'quote',
      address,
      expect.objectContaining({
        isNewOrder: false,
        isConfirmedReplay: false,
        shippingFee: undefined,
        shippingProvider: null,
      }),
      { persistAttestedCoordinates: false }
    );
  });
  it('does not load products or probe replay when there is no selected quote', async () => {
    const { params, from } = input();
    await prepareCheckoutQuoteDestination({ ...params, selectedQuoteId: null });
    expect(from).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
  });
  it('preserves invalid-item and lookup failure response shapes', async () => {
    const { params, query } = input();
    query.returns.mockRejectedValueOnce(
      new CanonicalOrderSubtotalLoadError('bad uuid', undefined, '22P02')
    );
    await expect(prepareCheckoutQuoteDestination(params)).resolves.toEqual({
      ok: false,
      status: 400,
      body: { error: 'Failed to create order', details: 'invalid_items' },
    });
    query.returns.mockRejectedValueOnce(new Error('lookup failed'));
    await expect(prepareCheckoutQuoteDestination(params)).resolves.toEqual({
      ok: false,
      status: 500,
      body: {
        error: 'Unable to validate quote',
        code: 'QUOTE_VALIDATION_FAILED',
      },
    });
  });
  it('preserves destination guard failures and lets unexpected failures propagate', async () => {
    const { params } = input();
    mocks.enrich.mockRejectedValueOnce(
      new OrderQuoteDestinationMismatchError(
        'wrong destination',
        'MISMATCH',
        400
      )
    );
    await expect(prepareCheckoutQuoteDestination(params)).resolves.toEqual({
      ok: false,
      status: 400,
      body: { error: 'wrong destination', code: 'MISMATCH' },
    });
    mocks.enrich.mockRejectedValueOnce(new Error('unexpected'));
    await expect(prepareCheckoutQuoteDestination(params)).rejects.toThrow(
      'unexpected'
    );
  });
});
