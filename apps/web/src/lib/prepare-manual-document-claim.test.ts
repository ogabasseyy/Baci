import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareManualDocumentClaim } from './prepare-manual-document-claim';

const claim = { token: 'tok', tokenHash: 'hash' };
const row = { id: 'outbox-1', claim_owner: 'worker', merchant_id: 'm-1' };
const order = {
  customer_id: 'cust-1',
  total: 5000,
  amount_paid: 5000,
  order_items: [{ name: 'Widget' }],
  payment_status: 'paid',
};
const createdPayload = {
  status: 'created',
  claim_id: 'claim-1',
  customer_id: 'cust-1',
  customer_email: 'buyer@example.com',
  order_total: 5000,
  order_amount_paid: 5000,
  order_item_count: 1,
  order_payment_status: 'paid',
};

function mockSupabase(rpcImpl: () => Promise<{ data: unknown; error: null }>) {
  return { rpc: vi.fn(rpcImpl) } as unknown as SupabaseClient;
}

describe('prepareManualDocumentClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ready with the prepared claim and custom domain', async () => {
    const supabase = mockSupabase(async () => ({
      data: createdPayload,
      error: null,
    }));
    const result = await prepareManualDocumentClaim({
      supabase,
      row,
      order,
      recipientEmail: 'buyer@example.com',
      claim,
      claimDomain: 'shop.example.com',
    });
    expect(result).toEqual({
      status: 'ready',
      prepared: createdPayload,
      claim,
      customDomain: 'shop.example.com',
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_manual_order_document_claim',
      { p_outbox_id: 'outbox-1', p_claim_owner: 'worker', p_token_hash: 'hash' }
    );
  });

  it('skips when the claim payload fails validation', async () => {
    const supabase = mockSupabase(async () => ({
      data: { status: 'created' },
      error: null,
    }));
    const result = await prepareManualDocumentClaim({
      supabase,
      row,
      order,
      recipientEmail: 'buyer@example.com',
      claim,
      claimDomain: 'shop.example.com',
    });
    expect(result).toEqual({
      status: 'skipped',
      reason: 'claim_validation_failed',
    });
  });

  it('skips when the claim is unavailable', async () => {
    const supabase = mockSupabase(async () => ({
      data: { status: 'skipped' },
      error: null,
    }));
    const result = await prepareManualDocumentClaim({
      supabase,
      row,
      order,
      recipientEmail: 'buyer@example.com',
      claim,
      claimDomain: 'shop.example.com',
    });
    expect(result).toEqual({
      status: 'skipped',
      reason: 'document_claim_unavailable',
    });
  });

  it('throws when the order changed between render and claim', async () => {
    const supabase = mockSupabase(async () => ({
      data: { ...createdPayload, order_total: 6000 },
      error: null,
    }));
    await expect(
      prepareManualDocumentClaim({
        supabase,
        row,
        order,
        recipientEmail: 'buyer@example.com',
        claim,
        claimDomain: 'shop.example.com',
      })
    ).rejects.toThrow('Manual document order changed during preparation');
  });
});
