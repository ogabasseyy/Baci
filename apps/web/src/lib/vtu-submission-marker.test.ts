import { describe, expect, it, vi } from 'vitest';
import {
  markVtuProviderSubmissionStarted,
  VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY,
} from './vtu-submission-marker';

describe('markVtuProviderSubmissionStarted', () => {
  function createSupabase(
    updateError: { message: string } | null,
    reread: {
      data: Record<string, unknown> | null;
      error: { message: string } | null;
    } = { data: null, error: null },
    updatedRow: { id: string } | null = updateError ? null : { id: 'vtu-1' }
  ) {
    // Chainable eq: the CAS write filters id + status (+ updated_at)
    // then selects the matched row id (Codex R94 P1).
    const eq: ReturnType<typeof vi.fn> = vi.fn(() => ({ eq, select }));
    const update = vi.fn(() => ({ eq }));
    const updateMaybeSingle = vi.fn(() =>
      Promise.resolve({ data: updatedRow, error: updateError })
    );
    const rereadMaybeSingle = vi.fn(() => Promise.resolve(reread));
    const rereadEq = vi.fn(() => ({ maybeSingle: rereadMaybeSingle }));
    const select = vi.fn((columns: string) =>
      columns === 'id' ? { maybeSingle: updateMaybeSingle } : { eq: rereadEq }
    );
    const supabase = { from: vi.fn(() => ({ select, update })) };
    return {
      eq,
      rereadEq,
      rereadMaybeSingle,
      select,
      supabase,
      update,
      updateMaybeSingle,
    };
  }

  it('persists the marker and reflects it on the row', async () => {
    const { eq, supabase, update } = createSupabase(null);
    const row: { id: string; metadata: Record<string, unknown> } = {
      id: 'vtu-1',
      metadata: { walletDebited: true },
    };

    const result = await markVtuProviderSubmissionStarted({
      row,
      supabase: supabase as never,
    });

    expect(result).toBeNull();
    expect(supabase.from).toHaveBeenCalledWith('vtu_transactions');
    expect(update).toHaveBeenCalledWith({
      metadata: expect.objectContaining({
        walletDebited: true,
        [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]: expect.any(String),
      }),
    });
    expect(eq).toHaveBeenCalledWith('id', 'vtu-1');
    expect(eq).toHaveBeenCalledWith('status', 'processing');
    expect(row.metadata[VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]).toEqual(
      expect.any(String)
    );
  });

  it('claims the updated_at generation token when the row carries one', async () => {
    const { eq, supabase } = createSupabase(null);
    const row = {
      id: 'vtu-1',
      metadata: { walletDebited: true },
      updated_at: '2026-10-14T21:00:00.000Z',
    };

    const result = await markVtuProviderSubmissionStarted({
      row,
      supabase: supabase as never,
    });

    expect(result).toBeNull();
    expect(eq).toHaveBeenCalledWith('updated_at', '2026-10-14T21:00:00.000Z');
  });

  it('fails closed on a zero-match lost race without retrying', async () => {
    // Codex R94 P1: this worker paused past the stale window after
    // the debit; a replay reclaimed and settled the row. The CAS
    // write matches nothing — report the lost race so the caller
    // restores instead of submitting a second provider purchase.
    const { select, supabase, update } = createSupabase(null, undefined, null);
    const row: {
      id: string;
      metadata: Record<string, unknown>;
      updated_at: string;
    } = {
      id: 'vtu-1',
      metadata: { walletDebited: true },
      updated_at: '2026-10-14T21:00:00.000Z',
    };

    const result = await markVtuProviderSubmissionStarted({
      row,
      supabase: supabase as never,
    });

    expect(result).toEqual({
      message: 'VTU provider-submission marker lost race: row moved or settled',
    });
    expect(row.metadata).toEqual({ walletDebited: true });
    expect(update).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith('id');
  });

  it('keeps the status-only gate for rows without a CAS token', async () => {
    const { eq, supabase } = createSupabase(null);
    const row: {
      id: string;
      metadata: Record<string, unknown>;
      updated_at: null;
    } = { id: 'vtu-1', metadata: { walletDebited: true }, updated_at: null };

    const result = await markVtuProviderSubmissionStarted({
      row,
      supabase: supabase as never,
    });

    expect(result).toBeNull();
    expect(eq).toHaveBeenCalledWith('status', 'processing');
    expect(eq).not.toHaveBeenCalledWith('updated_at', expect.anything());
  });

  it('reports the persist error without touching the row', async () => {
    const { supabase } = createSupabase({ message: 'db down' });
    const row = { id: 'vtu-1', metadata: { walletDebited: true } };

    const result = await markVtuProviderSubmissionStarted({
      row,
      supabase: supabase as never,
    });

    expect(result).toEqual({ message: 'db down' });
    expect(row.metadata).toEqual({ walletDebited: true });
  });

  it('adopts a marker the update committed but failed to report', async () => {
    // Response lost during the marker RTT (Codex R54 6rrFRC): the
    // re-read marker with no response reference is provably this
    // worker's — no provider call ran on the linear path here — so
    // adopt it and proceed to the vend instead of stranding the row.
    const markerAt = new Date().toISOString();
    const { rereadEq, select, supabase } = createSupabase(
      { message: 'timeout' },
      {
        data: {
          metadata: {
            walletDebited: true,
            [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]: markerAt,
          },
          status: 'processing',
          transaction_id: null,
        },
        error: null,
      }
    );
    const row: { id: string; metadata: Record<string, unknown> } = {
      id: 'vtu-1',
      metadata: { walletDebited: true },
    };

    const result = await markVtuProviderSubmissionStarted({
      row,
      supabase: supabase as never,
    });

    expect(result).toBeNull();
    expect(select).toHaveBeenCalledWith('metadata, status, transaction_id');
    expect(rereadEq).toHaveBeenCalledWith('id', 'vtu-1');
    expect(row.metadata[VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]).toBe(markerAt);
  });

  it('keeps the error when the re-read refutes the commit', async () => {
    // Truly failed write (no marker), lost re-read, vanished row, or
    // a status another worker moved: fail closed, row untouched.
    const cases: Array<Record<string, unknown> | null> = [
      {
        metadata: { walletDebited: true },
        status: 'processing',
        transaction_id: null,
      },
      {
        metadata: {
          walletDebited: true,
          [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]: new Date().toISOString(),
        },
        status: 'successful',
        transaction_id: null,
      },
      null,
    ];
    for (const data of cases) {
      const { supabase } = createSupabase(
        { message: 'timeout' },
        { data, error: null }
      );
      const row = { id: 'vtu-1', metadata: { walletDebited: true } };

      const result = await markVtuProviderSubmissionStarted({
        row,
        supabase: supabase as never,
      });

      expect(result).toEqual({ message: 'timeout' });
      expect(row.metadata).toEqual({ walletDebited: true });
    }

    const { supabase: rereadDown } = createSupabase(
      { message: 'timeout' },
      { data: null, error: { message: 'db down' } }
    );
    const row = { id: 'vtu-1', metadata: { walletDebited: true } };
    const result = await markVtuProviderSubmissionStarted({
      row,
      supabase: rereadDown as never,
    });
    expect(result).toEqual({ message: 'timeout' });
    expect(row.metadata).toEqual({ walletDebited: true });
  });

  it('keeps the error when another worker persisted a response', async () => {
    // Defense in depth (unreachable on the linear path): a re-read
    // response reference means a provider call answered — adopting
    // and vending would double-value.
    for (const response of [
      {
        metadata: {
          walletDebited: true,
          [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]: new Date().toISOString(),
        },
        status: 'processing',
        transaction_id: 'kuda-ref-1',
      },
      {
        metadata: {
          walletDebited: true,
          monnifyVendReference: 'VEND-1',
          [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]: new Date().toISOString(),
        },
        status: 'processing',
        transaction_id: null,
      },
    ]) {
      const { supabase } = createSupabase(
        { message: 'timeout' },
        { data: response, error: null }
      );
      const row = { id: 'vtu-1', metadata: { walletDebited: true } };

      const result = await markVtuProviderSubmissionStarted({
        row,
        supabase: supabase as never,
      });

      expect(result).toEqual({ message: 'timeout' });
      expect(row.metadata).toEqual({ walletDebited: true });
    }
  });

  it('retries the idempotent write after a genuinely-failed attempt and proceeds', async () => {
    // Codex R79 6sO3vb: the first write truly failed (re-read shows
    // no marker on a still-processing row) — the retry lands, the
    // ack proves presence, and the worker proceeds to the vend
    // instead of stranding the row behind a no-op restore.
    const { supabase, update, updateMaybeSingle } = createSupabase(
      { message: 'timeout' },
      {
        data: {
          metadata: { walletDebited: true },
          status: 'processing',
          transaction_id: null,
        },
        error: null,
      }
    );
    updateMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'timeout' },
    });
    updateMaybeSingle.mockResolvedValueOnce({
      data: { id: 'vtu-1' },
      error: null,
    });
    const row: { id: string; metadata: Record<string, unknown> } = {
      id: 'vtu-1',
      metadata: { walletDebited: true },
    };

    const result = await markVtuProviderSubmissionStarted({
      row,
      supabase: supabase as never,
    });

    expect(result).toBeNull();
    expect(update).toHaveBeenCalledTimes(2);
    expect(row.metadata[VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]).toEqual(
      expect.any(String)
    );
  });

  it('adopts when a retried re-read finds the committed marker', async () => {
    // Codex R79 6sO3vb: write response lost AND the first re-read
    // errored (the exact reported hole) — the second re-read finds
    // the committed marker with no response reference, so adopt it
    // and proceed instead of restoring with a dead token.
    const markerAt = new Date().toISOString();
    const { rereadMaybeSingle, supabase } = createSupabase({
      message: 'timeout',
    });
    rereadMaybeSingle
      .mockResolvedValueOnce({ data: null, error: { message: 'db down' } })
      .mockResolvedValueOnce({
        data: {
          metadata: {
            walletDebited: true,
            [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]: markerAt,
          },
          status: 'processing',
          transaction_id: null,
        },
        error: null,
      });
    const row: { id: string; metadata: Record<string, unknown> } = {
      id: 'vtu-1',
      metadata: { walletDebited: true },
    };

    const result = await markVtuProviderSubmissionStarted({
      row,
      supabase: supabase as never,
    });

    expect(result).toBeNull();
    expect(row.metadata[VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]).toBe(markerAt);
  });

  it('fails closed after exhausting write and re-read retries', async () => {
    // Sustained outage: every write and every re-read fails across
    // all attempts — return the last write error with the row
    // untouched, exactly like the pre-retry behavior.
    const { supabase, update } = createSupabase(
      { message: 'timeout' },
      { data: null, error: { message: 'db down' } }
    );
    const row = { id: 'vtu-1', metadata: { walletDebited: true } };

    const result = await markVtuProviderSubmissionStarted({
      row,
      supabase: supabase as never,
    });

    expect(result).toEqual({ message: 'timeout' });
    expect(update).toHaveBeenCalledTimes(3);
    expect(row.metadata).toEqual({ walletDebited: true });
  });

  it('does not retry states that resolved against us', async () => {
    // A moved status, a vanished row, or another worker's response
    // reference is definitive — fail closed on the first attempt
    // without burning retries that cannot adopt.
    const cases: Array<Record<string, unknown> | null> = [
      {
        metadata: {
          walletDebited: true,
          [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]: new Date().toISOString(),
        },
        status: 'successful',
        transaction_id: null,
      },
      {
        metadata: {
          walletDebited: true,
          [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]: new Date().toISOString(),
        },
        status: 'processing',
        transaction_id: 'kuda-ref-1',
      },
      null,
    ];
    for (const data of cases) {
      const { supabase, update } = createSupabase(
        { message: 'timeout' },
        { data, error: null }
      );
      const row = { id: 'vtu-1', metadata: { walletDebited: true } };

      const result = await markVtuProviderSubmissionStarted({
        row,
        supabase: supabase as never,
      });

      expect(result).toEqual({ message: 'timeout' });
      expect(update).toHaveBeenCalledTimes(1);
      expect(row.metadata).toEqual({ walletDebited: true });
    }
  });
});
