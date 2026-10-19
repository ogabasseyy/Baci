import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { LocalAirportDeliveryFeeMismatchError } from '@/lib/checkout/local-airport-delivery-fee-mismatch-error';
import { validateLocalAirportDeliveryFee } from '@/lib/checkout/validate-local-airport-delivery-fee';

const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174000';

function mockSupabase(replay = false): SupabaseClient {
  const rpc = vi.fn(() => Promise.resolve({ data: replay, error: null }));
  return { rpc } as unknown as SupabaseClient;
}

describe('validateLocalAirportDeliveryFee legacy compatibility', () => {
  it('does not infer airport delivery from a legacy fee on a metadata-free non-airport order', async () => {
    const result = await validateLocalAirportDeliveryFee({
      deliveryMethod: 'door',
      merchantId: MERCHANT_ID,
      shippingFee: 25_000,
      supabase: mockSupabase(),
    });

    expect(result).toEqual({
      isIdempotentLocalAirportReplay: false,
      localAirportShippingFee: null,
    });
  });

  it('rejects a metadata-free current airport-delivery fee without replay proof', async () => {
    const promise = validateLocalAirportDeliveryFee({
      merchantId: MERCHANT_ID,
      shippingFee: 35_000,
      supabase: mockSupabase(),
    });

    await expect(promise).rejects.toMatchObject({
      code: 'DELIVERY_METADATA_REQUIRED',
      status: 400,
    });
  });

  it('requires a released mobile client to refresh before accepting the changed airport fee', async () => {
    const promise = validateLocalAirportDeliveryFee({
      merchantId: MERCHANT_ID,
      shippingAddress: {
        address: 'Airport Delivery (Outside Lagos)',
        city: 'Airport',
        state: 'Nigeria',
      },
      shippingFee: 25_000,
      source: 'mobile_app',
      supabase: mockSupabase(),
    });

    await expect(promise).rejects.toMatchObject({
      code: 'AIRPORT_FEE_UPDATE_REQUIRED',
      status: 400,
    });
  });

  it.each([
    {
      address: 'Airport Delivery',
      code: 'AIRPORT_ADDRESS_REQUIRED',
      shippingFee: 35_000,
    },
    {
      address: 'Airport Pickup',
      code: 'AIRPORT_PICKUP_LOCATION_REQUIRED',
      shippingFee: 20_000,
    },
  ])('rejects a new marker-only legacy airport request', async ({
    address,
    code,
    shippingFee,
  }) => {
    const promise = validateLocalAirportDeliveryFee({
      merchantId: MERCHANT_ID,
      shippingAddress: { address },
      shippingFee,
      supabase: mockSupabase(),
    });

    await expect(promise).rejects.toMatchObject({
      code,
      status: 400,
    });
  });

  it('does not extend the legacy fee compatibility path to another source', async () => {
    const promise = validateLocalAirportDeliveryFee({
      merchantId: MERCHANT_ID,
      shippingAddress: { address: 'Airport Delivery' },
      shippingFee: 25_000,
      source: 'online_store',
      supabase: mockSupabase(),
    });

    await expect(promise).rejects.toBeInstanceOf(
      LocalAirportDeliveryFeeMismatchError
    );
  });

  it('rejects non-airport metadata that contradicts a legacy airport address marker', async () => {
    const promise = validateLocalAirportDeliveryFee({
      deliveryMethod: 'door',
      merchantId: MERCHANT_ID,
      shippingAddress: { address: 'Airport Delivery' },
      shippingFee: 0,
      supabase: mockSupabase(),
    });

    await expect(promise).rejects.toMatchObject({
      code: 'DELIVERY_METADATA_MISMATCH',
      status: 400,
    });
  });

  it('rejects a new metadata-free request at the legacy airport delivery fee', async () => {
    const promise = validateLocalAirportDeliveryFee({
      merchantId: MERCHANT_ID,
      shippingAddress: { address: '12 Airport Road' },
      shippingFee: 25_000,
      supabase: mockSupabase(),
    });

    await expect(promise).rejects.toMatchObject({
      code: 'DELIVERY_METADATA_REQUIRED',
      status: 400,
    });
  });

  it('allows a confirmed replay of a metadata-free legacy airport amount', async () => {
    const result = await validateLocalAirportDeliveryFee({
      merchantId: MERCHANT_ID,
      requestIdempotencyKey: 'legacy-airport-retry-key',
      shippingFee: 25_000,
      supabase: mockSupabase(true),
    });

    expect(result).toEqual({
      isIdempotentLocalAirportReplay: true,
      localAirportShippingFee: null,
    });
  });

  it('allows a confirmed replay of a synthetic legacy airport marker', async () => {
    const result = await validateLocalAirportDeliveryFee({
      merchantId: MERCHANT_ID,
      requestIdempotencyKey: 'legacy-airport-marker-retry-key',
      shippingAddress: { address: 'Airport Delivery' },
      shippingFee: 25_000,
      supabase: mockSupabase(true),
    });

    expect(result).toEqual({
      isIdempotentLocalAirportReplay: true,
      localAirportShippingFee: 35_000,
      resolvedDeliveryMethod: 'airport',
      resolvedAirportType: 'delivery',
    });
  });
});
