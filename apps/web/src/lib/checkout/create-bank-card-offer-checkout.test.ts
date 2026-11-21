import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { bankCardOfferContextFixture } from '@/schemas/bank-card-offer-payment-context.test-support';
import { createBankCardOfferCheckout } from './create-bank-card-offer-checkout';

afterEach(() => vi.unstubAllEnvs());

const quote = bankCardOfferContextFixture.quote;
const userId = 'dd4c43d6-f198-4f4a-a170-ea0fae4c16c0';

it('signs the exact JSON payload sent to the order RPC', async () => {
  vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'synthetic-bank-offer-test-secret');
  const result = { data: { id: 'order-1' }, error: null };
  const rpc = vi.fn().mockResolvedValue(result);
  const order = {
    merchant_id: quote.merchantId,
    items: [{ quantity: 1 }],
    notes: null,
  };

  await expect(
    createBankCardOfferCheckout({
      client: { rpc } as Pick<SupabaseClient, 'rpc'>,
      quote,
      userId,
      orderArgs: {
        p_merchant_id: quote.merchantId,
        p_items: [{ quantity: 1, variant_id: undefined }],
        p_notes: null,
        p_discount_code: undefined,
      },
    })
  ).resolves.toEqual(result);

  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    'create_storefront_bank_card_offer_order',
    {
      p_order: order,
      p_quote: quote,
      p_route_proof: expect.objectContaining({
        action: 'storefront_bank_card_offer_order_create',
        subject_id: quote.merchantId,
        user_id: userId,
        payload: { order, quote },
      }),
    }
  );
});

it('fails before creating an order if it cannot sign the payload', () => {
  vi.stubEnv('QUIZ_RPC_SERVER_SECRET', '');
  const rpc = vi.fn();

  expect(() =>
    createBankCardOfferCheckout({
      client: { rpc } as Pick<SupabaseClient, 'rpc'>,
      quote,
      userId,
      orderArgs: {},
    })
  ).toThrow();
  expect(rpc).not.toHaveBeenCalled();
});
