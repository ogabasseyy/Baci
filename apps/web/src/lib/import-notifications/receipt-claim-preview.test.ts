import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { hashReceiptClaimToken } from '@/lib/import-notifications/receipt-claim-links';
import {
  loadReceiptClaimLoginEmailHint,
  loadReceiptClaimPreview,
  parseReceiptClaimToken,
} from '@/lib/import-notifications/receipt-claim-preview';
import type { ReceiptLoginHintRpcClient } from '@/lib/receipts/server-login-hint-client';

const baseClaim = {
  claimed_at: null,
  customer_name: 'Bassey John',
  document_kind: 'receipt',
  expires_at: '2099-01-01T00:00:00.000Z',
  id: 'claim-1',
  kind: 'manual',
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

    expect(supabase.rpc).toHaveBeenCalledWith('preview_receipt_claim_v3', {
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

  it('loads a sanitized login email hint through the hint RPC', async () => {
    const supabase = createSupabaseRpcMock({ data: baseClaim, error: null });
    // The v3 payload carries no email: the hint function is the single
    // source of the raw address.
    const serviceSupabase: ReceiptLoginHintRpcClient = {
      rpc: vi.fn().mockResolvedValue({
        data: '  BasseyBJohn@Yahoo.CO.UK  ',
        error: null,
      }),
    };

    const result = await loadReceiptClaimLoginEmailHint({
      supabase,
      serviceSupabase,
      token: 'claim-token',
    });

    expect(supabase.rpc).toHaveBeenCalledWith('preview_receipt_claim_v3', {
      p_token_hash: hashReceiptClaimToken('claim-token'),
    });
    expect(result).toEqual({
      emailHint: 'b***@yahoo.co.uk',
      ok: true,
    });
  });

  it('serves the login hint from the service-role function', async () => {
    // The v3 preview never carries an email: the hint function is the only
    // source of the raw address.
    const supabase = createSupabaseRpcMock({
      data: baseClaim,
      error: null,
    });
    const serviceSupabase: ReceiptLoginHintRpcClient = {
      rpc: vi.fn().mockResolvedValue({
        data: '  BasseyBJohn@Yahoo.CO.UK  ',
        error: null,
      }),
    };

    const result = await loadReceiptClaimLoginEmailHint({
      supabase,
      serviceSupabase,
      token: 'claim-token',
    });

    expect(serviceSupabase.rpc).toHaveBeenCalledWith(
      'get_receipt_claim_login_hint',
      { p_token_hash: hashReceiptClaimToken('claim-token') }
    );
    expect(result).toEqual({
      emailHint: 'b***@yahoo.co.uk',
      ok: true,
    });
    // The full recipient address never reaches an unauthenticated caller,
    // even though the service function resolves it.
    expect(result.ok ? result.emailHint : '').not.toContain('basseybjohn');
  });

  it('throws when the hint function errors instead of falling back', async () => {
    // The hint function is predeploy-guaranteed and the v3 payload carries
    // no email, so there is nothing to fall back to: errors throw.
    const supabase = createSupabaseRpcMock({ data: baseClaim, error: null });
    const serviceSupabase: ReceiptLoginHintRpcClient = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST301', message: 'boom' },
      }),
    };

    await expect(
      loadReceiptClaimLoginEmailHint({
        supabase,
        serviceSupabase,
        token: 'claim-token',
      })
    ).rejects.toThrow('Failed to load receipt claim: boom');
  });

  it('drops invalid login email hints from the hint function', async () => {
    const supabase = createSupabaseRpcMock({ data: baseClaim, error: null });
    const serviceSupabase: ReceiptLoginHintRpcClient = {
      rpc: vi.fn().mockResolvedValue({
        data: 'not-an-email',
        error: null,
      }),
    };

    await expect(
      loadReceiptClaimLoginEmailHint({
        supabase,
        serviceSupabase,
        token: 'claim-token',
      })
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
