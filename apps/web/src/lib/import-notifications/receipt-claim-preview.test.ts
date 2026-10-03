import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { hashReceiptClaimToken } from '@/lib/import-notifications/receipt-claim-links';
import {
  loadReceiptClaimLoginEmailHint,
  loadReceiptClaimPreview,
  loadReceiptClaimPreviewWithLoginEmailHint,
  parseReceiptClaimToken,
} from '@/lib/import-notifications/receipt-claim-preview';

const baseClaim = {
  claimed_at: null,
  claimed_by_user_id: null,
  customer_email: 'basseybjohn@yahoo.co.uk',
  customer_id: 'customer-1',
  customer_name: 'Bassey John',
  document_kind: 'receipt',
  expires_at: '2099-01-01T00:00:00.000Z',
  id: 'claim-1',
  merchant_id: 'merchant-1',
  merchant: {
    business_name: 'Ogabassey',
    slug: 'ogabassey',
  },
  orders: [
    {
      id: 'order-1',
      order_items: [{ name: 'iPhone 16 Pro Max', quantity: 1 }],
      order_number: '06485',
    },
    {
      id: 'order-2',
      order_items: [{ name: 'AirPods Pro', quantity: 2 }],
      order_number: '06484',
    },
  ],
};

type SupabaseRpcMock = SupabaseClient & {
  rpc: ReturnType<typeof vi.fn>;
};

function createSupabaseRpcMock(response: {
  data: unknown;
  error: unknown;
}): SupabaseRpcMock {
  return {
    rpc: vi.fn().mockResolvedValue(response),
  } as unknown as SupabaseRpcMock;
}

describe('receipt claim preview', () => {
  it('parses valid route tokens and rejects malformed tokens', () => {
    expect(parseReceiptClaimToken('claim-token_123')).toBe('claim-token_123');
    expect(parseReceiptClaimToken('bad token')).toBeNull();
    expect(parseReceiptClaimToken(undefined)).toBeNull();
  });

  it('loads a claim preview through the preview RPC', async () => {
    const supabase = createSupabaseRpcMock({ data: baseClaim, error: null });

    const result = await loadReceiptClaimPreview({
      supabase,
      token: 'claim-token',
    });

    expect(supabase.rpc).toHaveBeenCalledWith('preview_receipt_claim', {
      p_token_hash: hashReceiptClaimToken('claim-token'),
    });
    expect(result).toEqual({
      claim: {
        claimed: false,
        customerName: 'Bassey John',
        devices: ['iPhone 16 Pro Max', '2 x AirPods Pro'],
        documentKind: 'receipt',
        merchantName: 'Ogabassey',
      },
      ok: true,
    });
  });

  it('carries the proforma kind through to the claim page', async () => {
    const supabase = createSupabaseRpcMock({
      data: { ...baseClaim, document_kind: 'proforma_invoice' },
      error: null,
    });

    const result = await loadReceiptClaimPreview({
      supabase,
      token: 'claim-token',
    });

    expect(result).toEqual({
      claim: expect.objectContaining({ documentKind: 'proforma_invoice' }),
      ok: true,
    });
  });

  it('surfaces legacy claims without a kind as unknown, not receipt', async () => {
    const supabase = createSupabaseRpcMock({
      data: { ...baseClaim, document_kind: null },
      error: null,
    });

    const result = await loadReceiptClaimPreview({
      supabase,
      token: 'claim-token',
    });

    expect(result).toEqual({
      claim: expect.objectContaining({ documentKind: 'unknown' }),
      ok: true,
    });
  });

  it('uses a generic merchant fallback when the claim merchant has no name', async () => {
    const supabase = createSupabaseRpcMock({
      data: {
        ...baseClaim,
        merchant: { business_name: null, slug: null },
      },
      error: null,
    });

    const result = await loadReceiptClaimPreview({
      supabase,
      token: 'claim-token',
    });

    expect(result).toEqual({
      claim: expect.objectContaining({ merchantName: 'Store' }),
      ok: true,
    });
  });

  it('loads a sanitized login email hint through the preview RPC', async () => {
    const supabase = createSupabaseRpcMock({
      data: {
        ...baseClaim,
        customer_email: '  BasseyBJohn@Yahoo.CO.UK  ',
      },
      error: null,
    });

    const result = await loadReceiptClaimLoginEmailHint({
      supabase,
      token: 'claim-token',
    });

    expect(supabase.rpc).toHaveBeenCalledWith('preview_receipt_claim', {
      p_token_hash: hashReceiptClaimToken('claim-token'),
    });
    expect(result).toEqual({
      emailHint: 'basseybjohn@yahoo.co.uk',
      ok: true,
    });
  });

  it('loads preview data and login email hints from one claim lookup', async () => {
    const supabase = createSupabaseRpcMock({
      data: {
        ...baseClaim,
        customer_email: '  BasseyBJohn@Yahoo.CO.UK  ',
      },
      error: null,
    });

    const result = await loadReceiptClaimPreviewWithLoginEmailHint({
      supabase,
      token: 'claim-token',
    });

    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(result).toEqual({
      claim: {
        claimed: false,
        customerName: 'Bassey John',
        devices: ['iPhone 16 Pro Max', '2 x AirPods Pro'],
        documentKind: 'receipt',
        merchantName: 'Ogabassey',
      },
      emailHint: 'basseybjohn@yahoo.co.uk',
      ok: true,
    });
  });

  it('drops invalid login email hints from claim data', async () => {
    const supabase = createSupabaseRpcMock({
      data: {
        ...baseClaim,
        customer_email: 'not-an-email',
      },
      error: null,
    });

    await expect(
      loadReceiptClaimLoginEmailHint({ supabase, token: 'claim-token' })
    ).resolves.toEqual({
      emailHint: '',
      ok: true,
    });
  });

  it('returns a not-found result when no claim matches the token', async () => {
    const supabase = createSupabaseRpcMock({ data: null, error: null });

    await expect(
      loadReceiptClaimPreview({ supabase, token: 'claim-token' })
    ).resolves.toEqual({
      error: 'Receipt claim link not found',
      ok: false,
      status: 404,
    });
  });

  it('returns an expired result when the claim is expired', async () => {
    const supabase = createSupabaseRpcMock({
      data: {
        ...baseClaim,
        expires_at: '2020-01-01T00:00:00.000Z',
      },
      error: null,
    });

    await expect(
      loadReceiptClaimPreview({ supabase, token: 'claim-token' })
    ).resolves.toEqual({
      error: 'Receipt claim link has expired',
      ok: false,
      status: 410,
    });
  });

  it('throws a generic error when the preview RPC fails', async () => {
    const supabase = createSupabaseRpcMock({
      data: null,
      error: { message: 'relation receipt_claims_secret does not exist' },
    });

    await expect(
      loadReceiptClaimPreview({ supabase, token: 'claim-token' })
    ).rejects.toThrow('Failed to load receipt claim');
  });

  it('throws when the preview RPC returns malformed claim data', async () => {
    const supabase = createSupabaseRpcMock({
      data: { id: 'claim-1' },
      error: null,
    });

    await expect(
      loadReceiptClaimPreview({ supabase, token: 'claim-token' })
    ).rejects.toThrow('invalid response structure');
  });
});
