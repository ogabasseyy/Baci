import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { validateLocalAirportDeliveryFee } from './validate-local-airport-delivery-fee';
import { validateSelectedAirportQuote } from './validate-selected-airport-quote';

const quote = {
  expires_at: '2099-01-01T00:00:00Z',
  price: 18500,
  provider: 'GIGL',
  provider_rate_id: 'GIGL_30_0_1_0_1_4',
};
function client(record: unknown = quote) {
  const rpc = vi.fn(async (name: string) => ({
    data: name === 'get_checkout_shipping_quote' ? [record] : false,
    error: null,
  }));
  return { rpc, supabase: { rpc } as unknown as SupabaseClient };
}
const input = {
  merchantId: 'merchant',
  selectedQuoteId: 'quote',
  shippingFee: 18500,
};
describe('airport quote with omitted redundant shipping provider', () => {
  it('derives GIGL from the already merchant-scoped quote without another lookup', async () => {
    const { rpc, supabase } = client();
    await expect(
      validateSelectedAirportQuote({ ...input, supabase })
    ).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('get_checkout_shipping_quote', {
      p_merchant_id: 'merchant',
      p_quote_id: 'quote',
    });
  });
  it('accepts an explicit airport checkout that omits the provider', async () => {
    const { supabase } = client();
    await expect(
      validateLocalAirportDeliveryFee({
        ...input,
        deliveryMethod: 'airport',
        shippingAddress: {
          address: '12 Airport Road',
          city: 'Ikeja',
          state: 'Lagos',
        },
        supabase,
      })
    ).resolves.toMatchObject({
      isIdempotentLocalAirportReplay: false,
      localAirportShippingFee: null,
    });
  });
  it.each([
    'TOPSHIP',
    '',
  ])('rejects a supplied conflicting provider %j', async (shippingProvider) => {
    await expect(
      validateSelectedAirportQuote({
        ...input,
        shippingProvider,
        supabase: client().supabase,
      })
    ).rejects.toMatchObject({ code: 'AIRPORT_QUOTE_INVALID' });
  });
  it('keeps airport service and fare validation when the provider is omitted', async () => {
    await expect(
      validateSelectedAirportQuote({
        ...input,
        supabase: client({ ...quote, provider_rate_id: 'GIGL_30_0_1_0_0_4' })
          .supabase,
      })
    ).rejects.toMatchObject({ code: 'AIRPORT_QUOTE_INVALID' });
    await expect(
      validateSelectedAirportQuote({
        ...input,
        shippingFee: 18000,
        supabase: client().supabase,
      })
    ).rejects.toMatchObject({ code: 'SHIPPING_FEE_MISMATCH' });
  });
});
