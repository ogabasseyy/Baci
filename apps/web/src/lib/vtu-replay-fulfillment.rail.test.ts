import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExistingIdempotencyRow } from '@/lib/vtu-idempotency-key-lookup';
import type { VtuWalletOnlyChargeInput } from '@/schemas/vtu-wallet-only';

const mocks = vi.hoisted(() => ({
  binding: vi.fn(),
  overlay: vi.fn(),
  fulfill: vi.fn(),
}));
vi.mock('@/lib/vtu-replay-binding', () => ({
  verifyReplayTransactionBinding: mocks.binding,
}));
vi.mock('@/lib/vtu-replay-attribute-overlay', () => ({
  overlayReplayAttributes: mocks.overlay,
}));
vi.mock('@/lib/vtu-fulfillment', () => ({
  fulfillPendingVtuTransaction: mocks.fulfill,
}));

import { fulfillReplayVtuTransaction } from './vtu-replay-fulfillment';

const KEY_ROW: ExistingIdempotencyRow = {
  key: '11111111-2222-3333-4444-555555555555',
  vtu_transaction_id: 'vtu-tx-winner',
  customer_id: 'customer-1',
  merchant_id: 'merchant-1',
  request_fingerprint: 'fp-1',
};

function supabase(piggyvestPaid: boolean | null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'customer-1', user_id: 'user-1' },
            error: null,
          }),
        })),
      })),
    })),
    rpc: vi.fn().mockResolvedValue({
      data: piggyvestPaid === null ? [] : [{ piggyvest_paid: piggyvestPaid }],
      error: null,
    }),
  } as unknown as SupabaseClient;
}

const replay = (client: SupabaseClient, walletPay: () => Promise<Response>) =>
  fulfillReplayVtuTransaction({
    authSupabase: client,
    input: {} as VtuWalletOnlyChargeInput,
    keyRow: KEY_ROW,
    supabase: client,
    user: { id: 'user-1' } as never,
    fulfillTransaction: walletPay,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.binding.mockResolvedValue({});
  mocks.overlay.mockResolvedValue({ updated: true, refreshed: false });
  mocks.fulfill.mockResolvedValue({
    amount: 1000,
    reference: 'VTU-WIN',
    status: 'successful',
  });
});

describe('bugfix: a PiggyVest request joined to a store credit purchase answered a terminal mismatch (Codex P1)', () => {
  it('replays the store credit winner through its own rail', async () => {
    const walletPay = vi.fn();
    const response = await replay(supabase(false), walletPay);
    expect(walletPay).not.toHaveBeenCalled();
    expect(mocks.fulfill).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'vtu-tx-winner' })
    );
    expect(response.status).toBe(200);
  });

  it('still replays a PiggyVest winner through the PiggyVest step', async () => {
    const walletPay = vi.fn(async () => new Response('{}', { status: 202 }));
    await replay(supabase(true), walletPay);
    expect(walletPay).toHaveBeenCalledWith('vtu-tx-winner');
    expect(mocks.fulfill).not.toHaveBeenCalled();
  });
});

describe('bugfix: an invisible purchase was routed to the PiggyVest step (Muse)', () => {
  it('replays it on the store credit rail, whose own checks answer it', async () => {
    const walletPay = vi.fn();
    await replay(supabase(null), walletPay);
    expect(walletPay).not.toHaveBeenCalled();
  });
});
