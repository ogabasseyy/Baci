import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateSessionId,
  getPrivateKey,
  getPublicKey,
  isLiveMode,
  signTransaction,
} from '@/lib/credit-direct';
import { createClient } from '@/lib/supabase/server';
import { POST } from './route';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/credit-direct', () => ({
  generateSessionId: vi.fn(),
  getPrivateKey: vi.fn(),
  getPublicKey: vi.fn(),
  isLiveMode: vi.fn(),
  signTransaction: vi.fn(),
}));

const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174000';
const ORDER_ID = '123e4567-e89b-12d3-a456-426614174111';
const CHECKOUT_TOKEN = 'raw-capability-token';
const DERIVED_AMOUNT = 120_000;

type RpcResult = { data: unknown; error: unknown };
type SettingsRow = {
  credit_direct_enabled: boolean;
  credit_direct_max_amount: number;
  credit_direct_min_amount: number;
  credit_direct_public_key: string;
  merchant_id: string;
};
type IssuedRow = {
  checkout_token: string;
  signed_amount: number;
  expires_at: string;
};

function buildSettingsRow(overrides: Partial<SettingsRow> = {}): SettingsRow {
  return {
    credit_direct_enabled: true,
    credit_direct_max_amount: 500_000,
    credit_direct_min_amount: 10_000,
    credit_direct_public_key: 'db-public-key',
    merchant_id: MERCHANT_ID,
    ...overrides,
  };
}

function buildIssuedRow(overrides: Partial<IssuedRow> = {}): IssuedRow {
  return {
    checkout_token: CHECKOUT_TOKEN,
    signed_amount: DERIVED_AMOUNT,
    expires_at: '2026-07-24T12:30:00.000Z',
    ...overrides,
  };
}

function createRequest(overrides: Record<string, unknown> = {}) {
  return new NextRequest(
    'https://example.com/api/payments/credit-direct/sign',
    {
      method: 'POST',
      body: JSON.stringify({
        customerEmail: 'customer@example.com',
        merchantSlug: 'ogabassey',
        orderId: ORDER_ID,
        totalAmount: 120_000,
        trackingToken: 'order-tracking-token',
        ...overrides,
      }),
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

function buildSupabaseMock(overrides: Partial<Record<string, RpcResult>> = {}) {
  const defaultResults: Record<string, RpcResult> = {
    get_credit_direct_settings: { data: [buildSettingsRow()], error: null },
    issue_credit_direct_checkout_token: {
      data: [buildIssuedRow()],
      error: null,
    },
    set_credit_direct_session: { data: true, error: null },
    ...overrides,
  };

  const rpc = vi.fn((name: string) =>
    Promise.resolve(defaultResults[name] ?? { data: null, error: null })
  );
  return { rpc };
}

describe('POST /api/payments/credit-direct/sign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn() } as never);
    vi.mocked(generateSessionId).mockReturnValue('session-123');
    vi.mocked(getPrivateKey).mockReturnValue('env-private-key');
    vi.mocked(getPublicKey).mockReturnValue('env-public-key');
    vi.mocked(isLiveMode).mockReturnValue(true);
    vi.mocked(signTransaction).mockReturnValue('signed-transaction');
    vi.mocked(createClient).mockReturnValue(buildSupabaseMock() as never);
  });

  it.each([
    { expectedField: 'customerEmail', overrides: { customerEmail: 'nope' } },
    { expectedField: 'merchantSlug', overrides: { merchantSlug: '' } },
    { expectedField: 'orderId', overrides: { orderId: 'not-a-uuid' } },
    { expectedField: 'totalAmount', overrides: { totalAmount: '1e3' } },
    // F1 regression: the tracking token gates capability minting, so a request
    // without it must fail validation before any signing/minting occurs.
    { expectedField: 'trackingToken', overrides: { trackingToken: '' } },
  ])('returns 400 before signing for invalid $expectedField', async ({
    expectedField,
    overrides,
  }) => {
    const response = await POST(createRequest(overrides));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid request');
    expect(body.details[expectedField]).toBeDefined();
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it('returns 404 before signing when the merchant is not found', async () => {
    vi.mocked(createClient).mockReturnValue(
      buildSupabaseMock({
        get_credit_direct_settings: { data: [], error: null },
      }) as never
    );

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Merchant not found' });
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it('returns 403 before signing when Credit Direct is disabled', async () => {
    vi.mocked(createClient).mockReturnValue(
      buildSupabaseMock({
        get_credit_direct_settings: {
          data: [buildSettingsRow({ credit_direct_enabled: false })],
          error: null,
        },
      }) as never
    );

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'Credit Direct BNPL is not enabled for this merchant',
    });
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it.each([
    { code: 'order_not_found', status: 404 },
    { code: 'order_not_payable', status: 409 },
    { code: 'amount_out_of_range', status: 400 },
    { code: 'credit_direct_disabled', status: 403 },
    { code: 'credit_direct_wallet_attempt_pending', status: 409 },
    { code: 'credit_direct_wallet_shipping_unsupported', status: 409 },
    { code: 'credit_direct_wallet_reconciliation_required', status: 409 },
    { code: 'credit_direct_wallet_origin_unverified', status: 409 },
  ])('maps issue-token RPC error $code to $status before signing', async ({
    code,
    status,
  }) => {
    vi.mocked(createClient).mockReturnValue(
      buildSupabaseMock({
        issue_credit_direct_checkout_token: {
          data: null,
          error: { message: code },
        },
      }) as never
    );

    const response = await POST(createRequest());

    expect(response.status).toBe(status);
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it('does not combine an environment private key with a merchant public key', async () => {
    vi.mocked(getPublicKey).mockImplementation(() => {
      throw new Error(
        'CREDIT_DIRECT_PUBLIC_KEY environment variable is not set'
      );
    });
    const supabase = buildSupabaseMock();
    vi.mocked(createClient).mockReturnValue(supabase as never);

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Credit Direct public key not configured' });
    expect(signTransaction).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'set_credit_direct_session',
      expect.anything()
    );
  });

  it('signs the server-derived amount and returns it with the session', async () => {
    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(signTransaction).toHaveBeenCalledWith(
      'session-123',
      'customer@example.com',
      DERIVED_AMOUNT,
      'env-private-key'
    );
    expect(body).toEqual({
      amount: DERIVED_AMOUNT,
      isLive: true,
      publicKey: 'env-public-key',
      sessionId: 'session-123',
      signature: 'signed-transaction',
    });
  });

  it('consumes the capability token minted by the issue RPC', async () => {
    const supabase = buildSupabaseMock();
    vi.mocked(createClient).mockReturnValue(supabase as never);

    await POST(createRequest());

    expect(supabase.rpc).toHaveBeenCalledWith(
      'issue_credit_direct_checkout_token',
      {
        p_email: 'customer@example.com',
        p_merchant_id: MERCHANT_ID,
        p_order_id: ORDER_ID,
        p_session_id: 'session-123',
        p_tracking_token: 'order-tracking-token',
      }
    );
    expect(supabase.rpc).toHaveBeenCalledWith('set_credit_direct_session', {
      p_checkout_token: CHECKOUT_TOKEN,
      p_merchant_id: MERCHANT_ID,
      p_order_id: ORDER_ID,
      p_session_id: 'session-123',
      p_signed_amount: DERIVED_AMOUNT,
    });
  });

  // Regression: caller-controlled amount. A tampered client `totalAmount` must
  // never be signed or recorded — only the DB-derived amount from the issue RPC.
  it('ignores a caller-controlled totalAmount and signs the DB-derived amount', async () => {
    const supabase = buildSupabaseMock();
    vi.mocked(createClient).mockReturnValue(supabase as never);

    const response = await POST(createRequest({ totalAmount: 5 }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.amount).toBe(DERIVED_AMOUNT);
    expect(signTransaction).toHaveBeenCalledWith(
      'session-123',
      'customer@example.com',
      DERIVED_AMOUNT,
      'env-private-key'
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      'set_credit_direct_session',
      expect.objectContaining({ p_signed_amount: DERIVED_AMOUNT })
    );
  });

  // Regression: replayed / already-used capability token. The consume RPC
  // raises `checkout_token_already_used`, which must surface as a 409 retry.
  it('returns 409 when the capability token was already consumed (replay)', async () => {
    vi.mocked(createClient).mockReturnValue(
      buildSupabaseMock({
        set_credit_direct_session: {
          data: null,
          error: { message: 'checkout_token_already_used' },
        },
      }) as never
    );

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('CHECKOUT_TOKEN_USED');
    expect(signTransaction).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when the token consume RPC fails opaquely', async () => {
    vi.mocked(createClient).mockReturnValue(
      buildSupabaseMock({
        set_credit_direct_session: {
          data: null,
          error: { message: 'connection reset' },
        },
      }) as never
    );

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'Failed to initialize Credit Direct checkout',
    });
    expect(signTransaction).toHaveBeenCalledTimes(1);
  });

  it('never leaks the raw capability token in the response', async () => {
    const response = await POST(createRequest());
    const body = await response.json();

    expect(JSON.stringify(body)).not.toContain(CHECKOUT_TOKEN);
  });
});
