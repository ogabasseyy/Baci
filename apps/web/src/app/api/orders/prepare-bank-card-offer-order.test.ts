import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import type { OrderCreateInput } from '@/schemas/orders';
import { prepareBankCardOfferOrder } from './prepare-bank-card-offer-order';

const rpc = vi.fn();
const options = {
  merchantId: '123e4567-e89b-12d3-a456-426614174000',
  customerEmail: 'buyer@example.test',
  requestIdempotencyKey: 'checkout',
  hasVoucherItem: false,
  clientIp: '127.0.0.1',
  supabase: { rpc } as unknown as SupabaseClient,
};

it('leaves standard checkout to the existing route without reading any offer', async () => {
  await expect(
    prepareBankCardOfferOrder({
      ...options,
      body: { payment_method: 'card' } as OrderCreateInput,
    })
  ).resolves.toEqual({ kind: 'standard' });
  expect(rpc).not.toHaveBeenCalled();
});

it('rejects a bank offer without a matching signed-in buyer before reading any replay', async () => {
  const result = await prepareBankCardOfferOrder({
    ...options,
    userId: 'session-user',
    userEmail: 'other@example.test',
    body: {
      payment_method: 'bank_card_offer',
      bank_card_offer_id: 'black-friday',
    } as OrderCreateInput,
  });
  expect(result.kind).toBe('response');
  if (result.kind === 'response') {
    expect(result.response.status).toBe(409);
  }
  expect(rpc).not.toHaveBeenCalled();
});
