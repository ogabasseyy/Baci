import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { authenticateApiRequest } from '@/lib/api-auth';
import type { ExistingIdempotencyRow } from '@/lib/vtu-idempotency-key-lookup';
import type { VtuWalletOnlyChargeInput } from '@/schemas/vtu-wallet-only';

const { mockVerifyBinding, mockOverlay, mockFulfill } = vi.hoisted(() => ({
  mockVerifyBinding: vi.fn(),
  mockOverlay: vi.fn(),
  mockFulfill: vi.fn(),
}));

vi.mock('@/lib/vtu-replay-binding', () => ({
  verifyReplayTransactionBinding: mockVerifyBinding,
}));

vi.mock('@/lib/vtu-replay-attribute-overlay', () => ({
  overlayReplayAttributes: mockOverlay,
}));

vi.mock('@/lib/vtu-fulfillment', () => ({
  fulfillPendingVtuTransaction: mockFulfill,
}));

import { fulfillReplayVtuTransaction } from './vtu-replay-fulfillment';

type ReplayUser = NonNullable<
  Awaited<ReturnType<typeof authenticateApiRequest>>['user']
>;

const KEY_ROW: ExistingIdempotencyRow = {
  key: '11111111-2222-3333-4444-555555555555',
  vtu_transaction_id: 'vtu-tx-existing',
  customer_id: 'customer-1',
  merchant_id: 'merchant-1',
  request_fingerprint: 'fp-1',
};

const INPUT = {
  customerPhone: '08012345678',
  validationReference: 'VAL-1',
} as VtuWalletOnlyChargeInput;

const USER = { id: 'user-1' } as ReplayUser;

function buildSupabase(owner: {
  data: { id: string; user_id: string | null } | null;
  error: { message: string } | null;
}) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue(owner),
        })),
      })),
    })),
  } as unknown as SupabaseClient;
}

describe('fulfillReplayVtuTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyBinding.mockResolvedValue({});
    mockOverlay.mockResolvedValue({ updated: true, refreshed: false });
    mockFulfill.mockResolvedValue({
      amount: 1000,
      reference: 'VTU-REF-OLD',
      status: 'successful',
    });
  });

  it('rejects with 400 when the transaction binding fails', async () => {
    mockVerifyBinding.mockResolvedValue({ error: 'binding mismatch' });
    const supabase = buildSupabase({
      data: { id: 'customer-1', user_id: 'user-1' },
      error: null,
    });

    const response = await fulfillReplayVtuTransaction({
      authSupabase: supabase,
      input: INPUT,
      keyRow: KEY_ROW,
      supabase,
      user: USER,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'binding mismatch',
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mockOverlay).not.toHaveBeenCalled();
    expect(mockFulfill).not.toHaveBeenCalled();
  });

  it('throws when the owner lookup errors (route maps to 500, key kept)', async () => {
    // Codex R129 P1: a transient lookup error is indeterminate — a
    // 400 would rotate the key and risk a second debit under a fresh
    // key for an already-debited transaction.
    const supabase = buildSupabase({
      data: null,
      error: { message: 'connection reset' },
    });

    await expect(
      fulfillReplayVtuTransaction({
        authSupabase: supabase,
        input: INPUT,
        keyRow: KEY_ROW,
        supabase,
        user: USER,
      })
    ).rejects.toThrow(/Failed to resolve replay owner/);
    expect(mockOverlay).not.toHaveBeenCalled();
    expect(mockFulfill).not.toHaveBeenCalled();
  });

  it.each([
    ['vanished row', null],
    ['unlinked guest', { id: 'customer-1', user_id: null }],
    ['foreign owner', { id: 'customer-1', user_id: 'other-user' }],
  ])('rejects with 425 for %s (key kept, no overlay or fulfill)', async (_label, row) => {
    const supabase = buildSupabase({ data: row, error: null });

    const response = await fulfillReplayVtuTransaction({
      authSupabase: supabase,
      input: INPUT,
      keyRow: KEY_ROW,
      supabase,
      user: USER,
    });

    // Codex R152 P1: 425 is in both clients' no-rotation carve-out
    // — a 400 would rotate to a fresh key whose fresh prepare
    // could debit a second transaction. The message must never
    // instruct a fresh key.
    expect(response.status).toBe(425);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/same purchase instead of starting a new one/);
    expect(body.error).not.toMatch(/fresh key/i);
    expect(mockOverlay).not.toHaveBeenCalled();
    expect(mockFulfill).not.toHaveBeenCalled();
  });

  it('propagates overlay failures without fulfilling', async () => {
    mockOverlay.mockRejectedValue(new Error('overlay RPC down'));
    const supabase = buildSupabase({
      data: { id: 'customer-1', user_id: 'user-1' },
      error: null,
    });

    await expect(
      fulfillReplayVtuTransaction({
        authSupabase: supabase,
        input: INPUT,
        keyRow: KEY_ROW,
        supabase,
        user: USER,
      })
    ).rejects.toThrow('overlay RPC down');
    expect(mockFulfill).not.toHaveBeenCalled();
  });

  it('overlays current-attempt values then fulfills and maps the response', async () => {
    const supabase = buildSupabase({
      data: { id: 'customer-1', user_id: 'user-1' },
      error: null,
    });
    const authSupabase = buildSupabase({
      data: { id: 'customer-1', user_id: 'user-1' },
      error: null,
    });

    const response = await fulfillReplayVtuTransaction({
      authSupabase,
      input: INPUT,
      keyRow: KEY_ROW,
      supabase,
      user: USER,
    });

    expect(mockOverlay).toHaveBeenCalledWith({
      supabase: authSupabase,
      transactionId: 'vtu-tx-existing',
      customerPhone: '08012345678',
      validationReference: 'VAL-1',
    });
    expect(mockFulfill).toHaveBeenCalledWith({
      supabase,
      transactionId: 'vtu-tx-existing',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reference: 'VTU-REF-OLD',
    });
  });
});
