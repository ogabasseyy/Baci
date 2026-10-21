import { VTU_CANONICAL_IDEMPOTENCY_KEY_HEADER } from '@baci/shared/lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { authenticateApiRequest } from '@/lib/api-auth';
import type { VtuWalletOnlyChargeInput } from '@/schemas/vtu-wallet-only';

const { mockDiscard, mockReplay } = vi.hoisted(() => ({
  mockDiscard: vi.fn(),
  mockReplay: vi.fn(),
}));

vi.mock('@/lib/vtu-claim-orphan-discard', () => ({
  discardOrphanedClaimTransaction: mockDiscard,
}));

vi.mock('@/lib/vtu-replay-fulfillment', () => ({
  fulfillReplayVtuTransaction: mockReplay,
}));

import { fulfillJoinedVtuClaim } from './vtu-claim-join';

type JoinUser = NonNullable<
  Awaited<ReturnType<typeof authenticateApiRequest>>['user']
>;

const USER = { id: 'user-1' } as JoinUser;
const INPUT = {
  customerPhone: '08012345678',
  validationReference: 'VAL-1',
} as VtuWalletOnlyChargeInput;

const CLIENTS = {
  authSupabase: {} as SupabaseClient,
  fulfillSupabase: { marker: 'privileged' } as unknown as SupabaseClient,
  userSupabase: { marker: 'user' } as unknown as SupabaseClient,
};

function callJoin() {
  return fulfillJoinedVtuClaim({
    ...CLIENTS,
    claim: {
      idempotency_key: 'winner-key-9',
      transaction_id: 'winner-tx-9',
    },
    customerId: 'customer-1',
    input: INPUT,
    merchantId: 'merchant-1',
    preparedTransactionId: 'loser-tx-1',
    requestFingerprint: 'fp-1',
    user: USER,
    userId: 'user-1',
  });
}

describe('fulfillJoinedVtuClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscard.mockResolvedValue(undefined);
    mockReplay.mockImplementation(async () => Response.json({ ok: true }));
  });

  it('discards the loser prepared row before replaying the winner', async () => {
    await callJoin();

    expect(mockDiscard).toHaveBeenCalledWith({
      context: 'join',
      merchantId: 'merchant-1',
      supabase: CLIENTS.userSupabase,
      transactionId: 'loser-tx-1',
      userId: 'user-1',
    });
    expect(mockDiscard.mock.invocationCallOrder[0]).toBeLessThan(
      mockReplay.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
    );
  });

  it('replays the winner with the joined key row on the privileged client', async () => {
    await callJoin();

    expect(mockReplay).toHaveBeenCalledWith({
      authSupabase: CLIENTS.authSupabase,
      input: INPUT,
      keyRow: {
        key: 'winner-key-9',
        vtu_transaction_id: 'winner-tx-9',
        customer_id: 'customer-1',
        merchant_id: 'merchant-1',
        request_fingerprint: 'fp-1',
      },
      supabase: CLIENTS.fulfillSupabase,
      user: USER,
    });
  });

  it('wires the winner key as the canonical retry key on the response', async () => {
    const response = await callJoin();

    expect(response.headers.get(VTU_CANONICAL_IDEMPOTENCY_KEY_HEADER)).toBe(
      'winner-key-9'
    );
  });

  it('logs transaction ids only — never the winner key', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      await callJoin();

      expect(info).toHaveBeenCalledTimes(1);
      const payload = info.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(payload).toMatchObject({
        preparedTransactionId: 'loser-tx-1',
        winnerTransactionId: 'winner-tx-9',
      });
      expect(JSON.stringify(info.mock.calls)).not.toContain('winner-key-9');
    } finally {
      info.mockRestore();
    }
  });
});
