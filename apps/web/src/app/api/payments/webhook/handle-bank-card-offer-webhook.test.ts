import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { handleBankCardOfferWebhook } from './handle-bank-card-offer-webhook';

const reference = `BCO-${'a'.repeat(32)}`;

it('declines a bank-offer reference on any gateway besides Paystack before looking it up', async () => {
  const rpc = vi.fn();
  const response = await handleBankCardOfferWebhook({
    finalize: vi.fn(),
    gateway: 'korapay',
    reference,
    supabase: { rpc } as unknown as SupabaseClient,
  });
  expect(response.status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});

it('files one platform review before acknowledging an unmatched Paystack reference', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
  const from = vi.fn().mockReturnValue({ insert });
  const response = await handleBankCardOfferWebhook({
    finalize: vi.fn(),
    gateway: 'paystack',
    reference,
    supabase: { rpc, from } as unknown as SupabaseClient,
  });
  expect(response.status).toBe(200);
  expect(from).toHaveBeenCalledWith('reconciliation_review');
  expect(insert).toHaveBeenCalledWith(
    expect.objectContaining({
      issue_type: 'payment_match_zero_candidates',
      paystack_ref: reference,
    })
  );
});
