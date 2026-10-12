import { describe, expect, it, vi } from 'vitest';
import {
  isStrandedPreVendVtuRow,
  restoreInterruptedPreVendVtuRow,
  STRANDED_PRE_VEND_STALE_MS,
} from './vtu-pre-vend-recovery';

function createAttemptChain(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn();
  const chain = Object.assign(Promise.resolve(result), { eq, select });
  eq.mockReturnValue(chain);
  return { eq, select, maybeSingle, chain };
}

function createSupabase(
  updateError: { message: string } | null = null,
  matchedRow: unknown = { id: 'vtu-1' }
) {
  const { eq, select } = createAttemptChain({
    data: updateError ? null : matchedRow,
    error: updateError,
  });
  const update = vi.fn(() => ({ eq }));
  return {
    eq,
    select,
    update,
    supabase: {
      from: vi.fn(() => ({ update })),
    },
  };
}

const SNAPSHOT_TOKEN = '2026-10-01T00:00:00.000Z';

describe('restoreInterruptedPreVendVtuRow', () => {
  it('flips the claimed row back to marked pending', async () => {
    const { eq, supabase, update } = createSupabase();

    await restoreInterruptedPreVendVtuRow({
      userSafeMessage:
        'VTU wallet debit failed; the purchase will resume automatically.',
      row: {
        id: 'vtu-1',
        metadata: { paymentSplit: { wallet: 300 } },
        updated_at: SNAPSHOT_TOKEN,
      },
      supabase: supabase as never,
    });

    expect(supabase.from).toHaveBeenCalledWith('vtu_transactions');
    expect(update).toHaveBeenCalledWith({
      error_message:
        'VTU wallet debit failed; the purchase will resume automatically.',
      metadata: expect.objectContaining({
        paymentSplit: { wallet: 300 },
        preVendInterruptedAt: expect.any(String),
      }),
      status: 'pending',
    });
    expect(eq).toHaveBeenCalledWith('id', 'vtu-1');
    expect(eq).toHaveBeenCalledWith('status', 'processing');
    // Compare-and-set: only the exact snapshot incarnation flips.
    expect(eq).toHaveBeenCalledWith('updated_at', SNAPSHOT_TOKEN);
  });

  it('logs (does not throw) when the restore write itself fails', async () => {
    const { supabase, update } = createSupabase({ message: 'write failed' });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        restoreInterruptedPreVendVtuRow({
          userSafeMessage: 'boom',
          row: { id: 'vtu-1', updated_at: SNAPSHOT_TOKEN },
          supabase: supabase as never,
        })
      ).resolves.toBeUndefined();
      // Bounded retry: the restore usually fails on the same transient
      // blip as the write it follows, so all three attempts run before
      // giving up to the reconciler's stranded-row recovery.
      expect(update).toHaveBeenCalledTimes(3);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to restore interrupted pre-vend VTU row:',
        expect.objectContaining({ attempts: 3, transactionId: 'vtu-1' })
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('recovers when a retry attempt succeeds', async () => {
    const fail = createAttemptChain({
      data: null,
      error: { message: 'blip' },
    });
    const succeed = createAttemptChain({
      data: { id: 'vtu-1' },
      error: null,
    });
    const update = vi
      .fn()
      .mockReturnValueOnce({ eq: fail.eq })
      .mockReturnValue({ eq: succeed.eq });
    const supabase = { from: vi.fn(() => ({ update })) };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await restoreInterruptedPreVendVtuRow({
        userSafeMessage: 'boom',
        row: { id: 'vtu-1', updated_at: SNAPSHOT_TOKEN },
        supabase: supabase as never,
      });

      expect(update).toHaveBeenCalledTimes(2);
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('stops without retrying when the row changed after the snapshot (lost race)', async () => {
    // ABA guard: another worker flipped, settled, reclaimed, or
    // touched metadata after our read — zero rows match, so the
    // stale snapshot must NOT overwrite the newer incarnation. The
    // token can never become valid again, so a single attempt runs.
    const { supabase, update } = createSupabase(null, null);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(
        restoreInterruptedPreVendVtuRow({
          userSafeMessage: 'boom',
          row: { id: 'vtu-1', updated_at: SNAPSHOT_TOKEN },
          supabase: supabase as never,
        })
      ).resolves.toBeUndefined();

      expect(update).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        'VTU pre-vend restore skipped: row changed after snapshot:',
        expect.objectContaining({ transactionId: 'vtu-1' })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('skips the flip when the snapshot has no updated_at (fail closed)', async () => {
    const { supabase, update } = createSupabase();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(
        restoreInterruptedPreVendVtuRow({
          userSafeMessage: 'boom',
          row: { id: 'vtu-1' },
          supabase: supabase as never,
        })
      ).resolves.toBeUndefined();

      expect(update).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        'VTU pre-vend restore skipped: no snapshot token:',
        expect.objectContaining({ transactionId: 'vtu-1' })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('isStrandedPreVendVtuRow', () => {
  const staleAt = new Date(
    Date.now() - STRANDED_PRE_VEND_STALE_MS - 1000
  ).toISOString();
  const freshAt = new Date(Date.now() - 1000).toISOString();

  it('flags a stale reference-less processing row with no debit marker', () => {
    // No walletDebited flag: the debit-flag write never landed, so no
    // provider call ever ran (the flag persists first). Re-driving
    // vends for the first time — it cannot double-credit. The wallet
    // leg proves the wallet pre-vend flow (card rows lack it).
    expect(
      isStrandedPreVendVtuRow({
        id: 'vtu-1',
        status: 'processing',
        transaction_id: null,
        error_message: null,
        metadata: { paymentSplit: { wallet: 1000, card: 0 } },
        created_at: new Date().toISOString(),
        updated_at: staleAt,
      })
    ).toBe(true);
  });

  it('declines post-marker card-only rows that legitimately lack the flag', () => {
    // fulfill writes walletDebited only when paymentSplit.wallet > 0,
    // so a card-only row never carries the flag — even when its vend
    // landed and only the result persistence failed. Flipping one
    // would re-vend a card-funded delivery.
    const base = {
      id: 'vtu-1',
      status: 'processing' as const,
      transaction_id: null,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: staleAt,
    };
    expect(isStrandedPreVendVtuRow({ ...base, metadata: {} })).toBe(false);
    expect(
      isStrandedPreVendVtuRow({
        ...base,
        metadata: { paymentSplit: { wallet: 0, card: 1000 } },
      })
    ).toBe(false);
    expect(
      isStrandedPreVendVtuRow({
        ...base,
        metadata: { paymentSplit: { wallet: '1000', card: 0 } },
      })
    ).toBe(false);
    expect(isStrandedPreVendVtuRow({ ...base, metadata: null })).toBe(false);
  });

  it('declines hybrid splits whose card leg may already be refunded', () => {
    // Wallet race: wallet never debited (no flag), card leg credited
    // by refundHybridWalletRace, then the failed-row write lands the
    // row reference-less processing. Re-driving would vend after a
    // partial refund — only exact-zero card legs flip.
    const base = {
      id: 'vtu-1',
      status: 'processing' as const,
      transaction_id: null,
      error_message: null,
      created_at: new Date().toISOString(),
      updated_at: staleAt,
    };
    expect(
      isStrandedPreVendVtuRow({
        ...base,
        metadata: { paymentSplit: { wallet: 300, card: 700 } },
      })
    ).toBe(false);
    expect(
      isStrandedPreVendVtuRow({
        ...base,
        metadata: { paymentSplit: { wallet: 1000 } },
      })
    ).toBe(false);
    expect(
      isStrandedPreVendVtuRow({
        ...base,
        metadata: { paymentSplit: { wallet: 1000, card: '0' } },
      })
    ).toBe(false);
  });

  it('declines a flagged row: the vend may have landed (post-vend persist failure)', () => {
    // Same reference-less shape, but the persisted flag proves the
    // flow reached the provider call: flipping would re-vend and
    // double-credit. Left to provider-evidence reconciliation.
    expect(
      isStrandedPreVendVtuRow({
        id: 'vtu-1',
        status: 'processing',
        transaction_id: null,
        error_message: null,
        metadata: { walletDebited: true },
        created_at: new Date().toISOString(),
        updated_at: staleAt,
      })
    ).toBe(false);
  });

  it('still flags a never-debited strand: the debit gate lives at the flip call site', () => {
    // The predicate is shape-only; the fail-closed debit check
    // (`hasExistingVtuDebitLedger`) runs at the fulfillment flip site
    // (Codex R39 rldXK), where a ledger read is available.
    expect(
      isStrandedPreVendVtuRow({
        id: 'vtu-1',
        status: 'processing',
        transaction_id: null,
        error_message: null,
        metadata: { paymentSplit: { wallet: 1000, card: 0 } },
        created_at: new Date().toISOString(),
        updated_at: staleAt,
      })
    ).toBe(true);
  });

  it('declines rows a live worker could still hold', () => {
    expect(
      isStrandedPreVendVtuRow({
        id: 'vtu-1',
        status: 'processing',
        transaction_id: null,
        error_message: null,
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: freshAt,
      })
    ).toBe(false);
  });

  it('declines rows without a last-write timestamp', () => {
    expect(
      isStrandedPreVendVtuRow({
        id: 'vtu-1',
        status: 'processing',
        transaction_id: null,
        error_message: null,
        metadata: {},
        updated_at: null,
      })
    ).toBe(false);
  });

  it('declines rows with any provider evidence (vend may have landed)', () => {
    const base = {
      id: 'vtu-1',
      status: 'processing' as const,
      created_at: new Date().toISOString(),
      updated_at: staleAt,
    };
    expect(
      isStrandedPreVendVtuRow({
        ...base,
        transaction_id: 'PROV-1',
        error_message: null,
        metadata: {},
      })
    ).toBe(false);
    expect(
      isStrandedPreVendVtuRow({
        ...base,
        transaction_id: null,
        error_message: 'provider said maybe',
        metadata: {},
      })
    ).toBe(false);
    expect(
      isStrandedPreVendVtuRow({
        ...base,
        transaction_id: null,
        error_message: null,
        metadata: { monnifyVendReference: 'VEND-1' },
      })
    ).toBe(false);
  });

  it('declines pre-marker legacy rows whose flag absence proves nothing', () => {
    // Created before the walletDebited marker shipped: the flow that
    // stranded this row never knew the flag, so absence is not
    // pre-vend evidence — flipping could re-vend a landed purchase.
    expect(
      isStrandedPreVendVtuRow({
        id: 'vtu-1',
        status: 'processing',
        transaction_id: null,
        error_message: null,
        metadata: {},
        created_at: '2026-01-15T00:00:00.000Z',
        updated_at: staleAt,
      })
    ).toBe(false);
  });

  it('declines rows with a missing creation timestamp', () => {
    expect(
      isStrandedPreVendVtuRow({
        id: 'vtu-1',
        status: 'processing',
        transaction_id: null,
        error_message: null,
        metadata: {},
        created_at: null,
        updated_at: staleAt,
      })
    ).toBe(false);
  });

  it('declines non-processing rows', () => {
    expect(
      isStrandedPreVendVtuRow({
        id: 'vtu-1',
        status: 'pending',
        transaction_id: null,
        error_message: null,
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: staleAt,
      })
    ).toBe(false);
  });
});
