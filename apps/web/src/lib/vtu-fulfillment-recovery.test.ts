import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasExistingVtuDebitLedger: vi.fn(),
  hasVtuCollectionEvidence: vi.fn(),
  isFlaggedReferenceLessVtuRow: vi.fn(),
  isMarkedUnsubmittedMonnifyVtuRow: vi.fn(),
  isStrandedPreVendVtuRow: vi.fn(),
  isUnsubmittedPreparedVtuRow: vi.fn(),
  markVtuProviderSubmissionStarted: vi.fn(),
  restoreInterruptedPreVendVtuRow: vi.fn(),
}));

vi.mock('@/lib/vtu-debit-ledger-lookup', () => ({
  hasExistingVtuDebitLedger: mocks.hasExistingVtuDebitLedger,
}));
vi.mock('@/lib/vtu-flagged-recovery', () => ({
  isFlaggedReferenceLessVtuRow: mocks.isFlaggedReferenceLessVtuRow,
  isMarkedUnsubmittedMonnifyVtuRow: mocks.isMarkedUnsubmittedMonnifyVtuRow,
  isUnsubmittedPreparedVtuRow: mocks.isUnsubmittedPreparedVtuRow,
}));
vi.mock('@/lib/vtu-pre-vend-recovery', () => ({
  isStrandedPreVendVtuRow: mocks.isStrandedPreVendVtuRow,
  restoreInterruptedPreVendVtuRow: mocks.restoreInterruptedPreVendVtuRow,
}));
vi.mock('@/lib/vtu-refund-collection-evidence', () => ({
  hasVtuCollectionEvidence: mocks.hasVtuCollectionEvidence,
}));
vi.mock('@/lib/vtu-submission-marker', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/vtu-submission-marker')
  >('@/lib/vtu-submission-marker');
  return {
    ...actual,
    markVtuProviderSubmissionStarted: mocks.markVtuProviderSubmissionStarted,
  };
});

import type { VtuTransactionRow } from '@/lib/vtu-fulfillment';
import { VtuPersistenceError } from '@/lib/vtu-persistence-error';
import { VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY } from '@/lib/vtu-submission-marker';
import {
  persistVtuWalletDebitConfirmation,
  recoverStrandedPreVendVtuRow,
  shouldSkipRefundWithoutCollectionEvidence,
  writeVtuProviderSubmissionMarkerOrRestore,
} from './vtu-fulfillment-recovery';

const row = { id: 'vtu-1' } as VtuTransactionRow;
const supabase = {} as unknown as SupabaseClient;

describe('vtu-fulfillment-recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasExistingVtuDebitLedger.mockResolvedValue(false);
    mocks.hasVtuCollectionEvidence.mockResolvedValue(true);
    mocks.isFlaggedReferenceLessVtuRow.mockReturnValue(false);
    mocks.isMarkedUnsubmittedMonnifyVtuRow.mockReturnValue(false);
    mocks.isStrandedPreVendVtuRow.mockReturnValue(false);
    mocks.isUnsubmittedPreparedVtuRow.mockReturnValue(false);
    mocks.markVtuProviderSubmissionStarted.mockResolvedValue(null);
    mocks.restoreInterruptedPreVendVtuRow.mockResolvedValue(undefined);
  });

  it('restores ledger-backed strands and continues', async () => {
    mocks.isStrandedPreVendVtuRow.mockReturnValue(true);
    mocks.hasExistingVtuDebitLedger.mockResolvedValue(true);

    const result = await recoverStrandedPreVendVtuRow({ row, supabase });

    expect(result).toBe('continue');
    expect(mocks.restoreInterruptedPreVendVtuRow).toHaveBeenCalledWith(
      expect.objectContaining({
        row,
        userSafeMessage: expect.stringContaining('stranded pre-vend'),
      })
    );
  });

  it('leaves never-debited strands for support (fail closed)', async () => {
    mocks.isStrandedPreVendVtuRow.mockReturnValue(true);
    mocks.hasExistingVtuDebitLedger.mockResolvedValue(false);

    const result = await recoverStrandedPreVendVtuRow({ row, supabase });

    expect(result).toBe('continue');
    expect(mocks.restoreInterruptedPreVendVtuRow).not.toHaveBeenCalled();
  });

  it.each([
    ['isUnsubmittedPreparedVtuRow', 'unsubmitted prepared'],
    ['isMarkedUnsubmittedMonnifyVtuRow', 'marked unsubmitted Monnify'],
  ])('restores %s rows for re-drive', async (predicate, messagePart) => {
    mocks[predicate as 'isUnsubmittedPreparedVtuRow'].mockReturnValue(true);

    const result = await recoverStrandedPreVendVtuRow({ row, supabase });

    expect(result).toBe('continue');
    expect(mocks.restoreInterruptedPreVendVtuRow).toHaveBeenCalledWith(
      expect.objectContaining({
        userSafeMessage: expect.stringContaining(messagePart as string),
      })
    );
  });

  it('routes flagged reference-less rows to provider-truth settlement', async () => {
    mocks.isFlaggedReferenceLessVtuRow.mockReturnValue(true);

    const result = await recoverStrandedPreVendVtuRow({ row, supabase });

    expect(result).toBe('settle-from-provider');
    expect(mocks.restoreInterruptedPreVendVtuRow).not.toHaveBeenCalled();
  });

  it('continues past ordinary rows without restoring', async () => {
    const result = await recoverStrandedPreVendVtuRow({ row, supabase });

    expect(result).toBe('continue');
    expect(mocks.restoreInterruptedPreVendVtuRow).not.toHaveBeenCalled();
  });

  it('marker success resolves without restoring', async () => {
    await expect(
      writeVtuProviderSubmissionMarkerOrRestore({ row, supabase })
    ).resolves.toBeUndefined();
    expect(mocks.restoreInterruptedPreVendVtuRow).not.toHaveBeenCalled();
  });

  it('marker failure restores then throws persistence error', async () => {
    mocks.markVtuProviderSubmissionStarted.mockResolvedValue({
      message: 'connection reset',
    });

    await expect(
      writeVtuProviderSubmissionMarkerOrRestore({ row, supabase })
    ).rejects.toBeInstanceOf(VtuPersistenceError);
    expect(mocks.restoreInterruptedPreVendVtuRow).toHaveBeenCalledWith(
      expect.objectContaining({ row })
    );
  });

  it('skips card-only refunds only without collection evidence', async () => {
    const metadata = {};
    await expect(
      shouldSkipRefundWithoutCollectionEvidence({ metadata, row, supabase })
    ).resolves.toBe(false);

    mocks.hasVtuCollectionEvidence.mockResolvedValue(false);
    await expect(
      shouldSkipRefundWithoutCollectionEvidence({ metadata, row, supabase })
    ).resolves.toBe(true);
  });

  describe('persistVtuWalletDebitConfirmation', () => {
    function createConfirmSupabase(
      confirmResult: {
        data: { updated_at: string } | null;
        error: { message: string } | null;
      },
      rereadResult: {
        data: Record<string, unknown> | null;
        error: { message: string } | null;
      } = { data: null, error: null }
    ) {
      const eqCalls: [string, unknown][] = [];
      const confirmMaybeSingle = vi.fn(() => Promise.resolve(confirmResult));
      const makeChain = (): {
        eq: ReturnType<typeof vi.fn>;
        select: ReturnType<typeof vi.fn>;
      } => {
        const chain = {} as {
          eq: ReturnType<typeof vi.fn>;
          select: ReturnType<typeof vi.fn>;
        };
        chain.eq = vi.fn((column: string, value: unknown) => {
          eqCalls.push([column, value]);
          return chain;
        });
        chain.select = vi.fn(() => ({ maybeSingle: confirmMaybeSingle }));
        return chain;
      };
      const update = vi.fn(() => makeChain());
      const rereadMaybeSingle = vi.fn(() => Promise.resolve(rereadResult));
      const select = vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: rereadMaybeSingle })),
      }));
      return {
        eqCalls,
        rereadMaybeSingle,
        select,
        supabase: { from: vi.fn(() => ({ select, update })) },
        update,
      };
    }

    function confirmRow(updated_at: string | null) {
      return {
        id: 'vtu-1',
        metadata: { split: 'wallet' },
        status: 'processing',
        updated_at,
      } as unknown as VtuTransactionRow;
    }

    it('persists the flag and refreshes the CAS token', async () => {
      const { eqCalls, supabase: confirmSupabase } = createConfirmSupabase({
        data: { updated_at: 'tok-2' },
        error: null,
      });
      const debitRow = confirmRow('tok-1');

      await persistVtuWalletDebitConfirmation({
        preDebitMetadata: { split: 'wallet' },
        row: debitRow,
        supabase: confirmSupabase as unknown as SupabaseClient,
      });

      expect(debitRow.metadata).toEqual({
        split: 'wallet',
        walletDebited: true,
      });
      expect(debitRow.updated_at).toBe('tok-2');
      expect(eqCalls).toContainEqual(['status', 'processing']);
      expect(eqCalls).toContainEqual(['updated_at', 'tok-1']);
      expect(mocks.restoreInterruptedPreVendVtuRow).not.toHaveBeenCalled();
    });

    it('throws a lost-race error on zero-match without flagging the debit', async () => {
      // Codex R95 P1: another worker moved the row after our claim
      // (stale recovery restored it, a replay reclaimed it). The
      // ungated write would clobber the reclaiming worker's marker
      // and let both workers submit the same Kuda purchase.
      const { supabase: confirmSupabase } = createConfirmSupabase({
        data: null,
        error: null,
      });
      const debitRow = confirmRow('tok-1');

      await expect(
        persistVtuWalletDebitConfirmation({
          preDebitMetadata: { split: 'wallet' },
          row: debitRow,
          supabase: confirmSupabase as unknown as SupabaseClient,
        })
      ).rejects.toBeInstanceOf(VtuPersistenceError);
      await expect(
        persistVtuWalletDebitConfirmation({
          preDebitMetadata: { split: 'wallet' },
          row: confirmRow('tok-1'),
          supabase: confirmSupabase as unknown as SupabaseClient,
        }).catch((error: unknown) => (error as Error).message)
      ).resolves.toMatch(/lost race/);
      expect(debitRow.metadata).toEqual({ split: 'wallet' });
      expect(mocks.restoreInterruptedPreVendVtuRow).toHaveBeenCalledWith(
        expect.objectContaining({
          row: debitRow,
          userSafeMessage:
            'VTU wallet debit confirmation conflicted; the purchase will resume automatically.',
        })
      );
    });

    it('adopts the flag when the errored write actually committed', async () => {
      // Codex R105 P1: the UPDATE landed but its response was lost —
      // the row carries walletDebited under a newer token. Adopt the
      // fresh token + metadata and proceed to the provider instead
      // of restoring with the stale token (which matches nothing and
      // strands the debited row without a marker).
      const { supabase: confirmSupabase } = createConfirmSupabase(
        { data: null, error: { message: 'connection reset' } },
        {
          data: {
            metadata: { split: 'wallet', walletDebited: true },
            status: 'processing',
            transaction_id: null,
            updated_at: 'tok-2',
          },
          error: null,
        }
      );
      const debitRow = confirmRow('tok-1');

      await persistVtuWalletDebitConfirmation({
        preDebitMetadata: { split: 'wallet' },
        row: debitRow,
        supabase: confirmSupabase as unknown as SupabaseClient,
      });

      expect(debitRow.metadata).toEqual({
        split: 'wallet',
        walletDebited: true,
      });
      expect(debitRow.updated_at).toBe('tok-2');
      expect(mocks.restoreInterruptedPreVendVtuRow).not.toHaveBeenCalled();
    });

    it('restores when the ambiguous re-read shows a rival marker', async () => {
      // Codex R105 P1: a marker means someone owns submission — the
      // flag may be theirs. Adopting would clobber their marker at
      // the downstream CAS and double-vend; restore + throw instead.
      const { supabase: confirmSupabase } = createConfirmSupabase(
        { data: null, error: { message: 'connection reset' } },
        {
          data: {
            metadata: {
              split: 'wallet',
              walletDebited: true,
              [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]:
                '2020-01-01T00:00:00.000Z',
            },
            status: 'processing',
            transaction_id: null,
            updated_at: 'tok-9',
          },
          error: null,
        }
      );

      await expect(
        persistVtuWalletDebitConfirmation({
          preDebitMetadata: { split: 'wallet' },
          row: confirmRow('tok-1'),
          supabase: confirmSupabase as unknown as SupabaseClient,
        })
      ).rejects.toBeInstanceOf(VtuPersistenceError);
      expect(mocks.restoreInterruptedPreVendVtuRow).toHaveBeenCalledWith(
        expect.objectContaining({
          userSafeMessage:
            'VTU wallet debit confirmation failed; the purchase will resume automatically.',
        })
      );
    });

    it('restores when the ambiguous re-read itself fails', async () => {
      // Codex R105 P1: fully ambiguous — keep the pre-existing
      // restore + throw (locks the old behavior for the
      // unrecoverable case).
      const { supabase: confirmSupabase } = createConfirmSupabase(
        { data: null, error: { message: 'connection reset' } },
        { data: null, error: { message: 'reread failed' } }
      );

      await expect(
        persistVtuWalletDebitConfirmation({
          preDebitMetadata: { split: 'wallet' },
          row: confirmRow('tok-1'),
          supabase: confirmSupabase as unknown as SupabaseClient,
        })
      ).rejects.toBeInstanceOf(VtuPersistenceError);
      expect(mocks.restoreInterruptedPreVendVtuRow).toHaveBeenCalledTimes(1);
    });

    it('restores when the ambiguous re-read shows no flag', async () => {
      // Codex R105 P1: the write genuinely failed — nothing to
      // adopt. Restore + throw so the retry re-drives cleanly.
      const { supabase: confirmSupabase } = createConfirmSupabase(
        { data: null, error: { message: 'connection reset' } },
        {
          data: {
            metadata: { split: 'wallet' },
            status: 'processing',
            transaction_id: null,
            updated_at: 'tok-1',
          },
          error: null,
        }
      );

      await expect(
        persistVtuWalletDebitConfirmation({
          preDebitMetadata: { split: 'wallet' },
          row: confirmRow('tok-1'),
          supabase: confirmSupabase as unknown as SupabaseClient,
        })
      ).rejects.toBeInstanceOf(VtuPersistenceError);
      expect(mocks.restoreInterruptedPreVendVtuRow).toHaveBeenCalledTimes(1);
    });

    it('keeps the status-only gate for rows without a CAS token', async () => {
      const { eqCalls, supabase: confirmSupabase } = createConfirmSupabase({
        data: { updated_at: 'tok-9' },
        error: null,
      });
      const debitRow = confirmRow(null);

      await persistVtuWalletDebitConfirmation({
        preDebitMetadata: {},
        row: debitRow,
        supabase: confirmSupabase as unknown as SupabaseClient,
      });

      expect(debitRow.metadata).toEqual({ walletDebited: true });
      expect(eqCalls).toContainEqual(['status', 'processing']);
      expect(eqCalls.some(([column]) => column === 'updated_at')).toBe(false);
    });
  });
});
