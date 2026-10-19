import { describe, expect, it, vi } from 'vitest';
import {
  cleanupOrphanVtuTransactionAfterKeyRace,
  VTU_ORPHAN_DISCARD_MESSAGE,
} from './vtu-orphan-transaction-cleanup';
import { VTU_REFUND_SKIPPED_NO_COLLECTION } from './vtu-refund-collection-evidence';

describe('cleanupOrphanVtuTransactionAfterKeyRace', () => {
  function createSupabase({
    deleteData = { id: 'vtu-orphan' },
    deleteError = null,
    rereadData = null,
    rereadError = null,
    markData = { id: 'vtu-orphan' },
    markError = null,
  }: {
    deleteData?: Record<string, unknown> | null;
    deleteError?: { message: string } | null;
    rereadData?: Record<string, unknown> | null;
    rereadError?: { message: string } | null;
    markData?: Record<string, unknown> | null;
    markError?: { message: string } | null;
  } = {}) {
    const updateCalls: Record<string, unknown>[] = [];
    const deleteMaybeSingle = vi.fn(() =>
      Promise.resolve({ data: deleteData, error: deleteError })
    );
    const deleteSelect = vi.fn(() => ({ maybeSingle: deleteMaybeSingle }));
    const deleteEq = vi.fn(() => ({ eq: deleteEq, select: deleteSelect }));
    const rereadMaybeSingle = vi.fn(() =>
      Promise.resolve({ data: rereadData, error: rereadError })
    );
    const rereadEq = vi.fn(() => ({ maybeSingle: rereadMaybeSingle }));
    const rereadSelect = vi.fn(() => ({ eq: rereadEq }));
    const markMaybeSingle = vi.fn(() =>
      Promise.resolve({ data: markData, error: markError })
    );
    const markSelect = vi.fn(() => ({ maybeSingle: markMaybeSingle }));
    const markEq = vi.fn(() => ({ eq: markEq, select: markSelect }));
    const update = vi.fn((payload: Record<string, unknown>) => {
      updateCalls.push(payload);
      return { eq: markEq };
    });
    const from = vi.fn((table: string) => {
      if (table !== 'vtu_transactions') {
        throw new Error(`unexpected table ${table}`);
      }
      // First chain built is the delete; selects distinguish the
      // re-read (top-level select) from the mark (update-eq-eq).
      return {
        delete: vi.fn(() => ({ eq: deleteEq })),
        select: rereadSelect,
        update,
      };
    });
    return {
      deleteEq,
      deleteMaybeSingle,
      deleteSelect,
      from,
      markEq,
      markMaybeSingle,
      rereadEq,
      rereadMaybeSingle,
      rereadSelect,
      supabase: { from },
      update,
      updateCalls,
    };
  }

  function cleanup(supabase: { from: unknown }) {
    return cleanupOrphanVtuTransactionAfterKeyRace({
      merchantId: 'merchant-1',
      supabase: supabase as never,
      transactionId: 'vtu-orphan',
    });
  }

  it('returns deleted when the verified delete lands', async () => {
    const { rereadSelect, supabase, update } = createSupabase();

    const outcome = await cleanup(supabase);

    expect(outcome).toBe('deleted');
    expect(rereadSelect).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('treats a vanished re-read as a landed delete', async () => {
    // Delete errored but the commit landed while its response was
    // lost: gone is gone — no mark needed.
    const { supabase, update } = createSupabase({
      deleteData: null,
      deleteError: { message: 'timeout' },
      rereadData: null,
    });

    const outcome = await cleanup(supabase);

    expect(outcome).toBe('deleted');
    expect(update).not.toHaveBeenCalled();
  });

  it('marks the orphan failed when the delete cannot be verified', async () => {
    // Muse R55 HIGH: log-and-continue would leave a pending orphan
    // the client never references — a stuck-pending spinner today,
    // a second debit if any reconciler ever fulfills unmapped
    // pendings. The terminal failed mark closes both.
    const { supabase, updateCalls } = createSupabase({
      deleteData: null,
      deleteError: { message: 'db down' },
      rereadData: {
        id: 'vtu-orphan',
        metadata: { provider: 'kuda' },
        status: 'pending',
      },
    });

    const outcome = await cleanup(supabase);

    expect(outcome).toBe('marked_failed');
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toEqual({
      error_message: VTU_ORPHAN_DISCARD_MESSAGE,
      metadata: {
        // First-party fixed copy: flagged safe so replays keep it
        // verbatim under the R89 P1 provenance rule.
        customerSafeErrorMessage: true,
        provider: 'kuda',
        refundSkipped: VTU_REFUND_SKIPPED_NO_COLLECTION,
      },
      status: 'failed',
    });
  });

  it('leaves a progressed row to its owner without marking', async () => {
    // Zero-match delete (status moved) or a re-read that is no
    // longer pending: someone owns this row — marking over a live
    // row would corrupt their completion.
    for (const status of ['processing', 'successful', 'failed']) {
      const { supabase, update } = createSupabase({
        deleteData: null,
        rereadData: { id: 'vtu-orphan', metadata: {}, status },
      });

      const outcome = await cleanup(supabase);

      expect(outcome).toBe('owned_elsewhere');
      expect(update).not.toHaveBeenCalled();
    }
  });

  it('reports unresolved when neither delete nor mark verifies', async () => {
    // Sustained outage: the re-read fails, or the mark errors, or
    // the mark zero-matches (status flipped between re-read and
    // mark). The caller proceeds (today's behavior) — no retry or
    // cron can see an unmapped row either.
    const rereadDown = createSupabase({
      deleteData: null,
      deleteError: { message: 'db down' },
      rereadError: { message: 'db down' },
    });
    await expect(cleanup(rereadDown.supabase)).resolves.toBe('unresolved');

    const markDown = createSupabase({
      deleteData: null,
      deleteError: { message: 'db down' },
      markError: { message: 'db down' },
      rereadData: { id: 'vtu-orphan', metadata: {}, status: 'pending' },
    });
    await expect(cleanup(markDown.supabase)).resolves.toBe('unresolved');

    const markRaced = createSupabase({
      deleteData: null,
      markData: null,
      rereadData: { id: 'vtu-orphan', metadata: {}, status: 'pending' },
    });
    await expect(cleanup(markRaced.supabase)).resolves.toBe('unresolved');
    expect(markRaced.updateCalls).toHaveLength(1);
  });

  it('retries a transient re-read error instead of stranding the orphan', async () => {
    // Codex R108 P2: a blip on the verification re-read must not
    // abandon a pending orphan no reconciler can discover.
    const { rereadMaybeSingle, supabase } = createSupabase({
      deleteData: null,
      deleteError: { message: 'timeout' },
      rereadData: { id: 'vtu-orphan', metadata: {}, status: 'pending' },
    });
    rereadMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'blip' },
    });

    const outcome = await cleanup(supabase);

    expect(outcome).toBe('marked_failed');
    expect(rereadMaybeSingle).toHaveBeenCalledTimes(2);
  });

  it('retries a transient mark error instead of stranding the orphan', async () => {
    const { markMaybeSingle, supabase, updateCalls } = createSupabase({
      deleteData: null,
      deleteError: { message: 'timeout' },
      rereadData: { id: 'vtu-orphan', metadata: {}, status: 'pending' },
    });
    markMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'blip' },
    });

    const outcome = await cleanup(supabase);

    expect(outcome).toBe('marked_failed');
    expect(updateCalls).toHaveLength(2);
  });

  it('gives up after exhausting retries under sustained outage', async () => {
    const { rereadMaybeSingle, supabase } = createSupabase({
      deleteData: null,
      deleteError: { message: 'db down' },
      rereadError: { message: 'db down' },
    });

    const outcome = await cleanup(supabase);

    expect(outcome).toBe('unresolved');
    expect(rereadMaybeSingle).toHaveBeenCalledTimes(3);
  });
});
