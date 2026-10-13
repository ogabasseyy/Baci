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
    } = { data: null, error: null }
  ) {
    const eq = vi.fn(() => Promise.resolve({ error: updateError }));
    const update = vi.fn(() => ({ eq }));
    const rereadMaybeSingle = vi.fn(() => Promise.resolve(reread));
    const rereadEq = vi.fn(() => ({ maybeSingle: rereadMaybeSingle }));
    const select = vi.fn(() => ({ eq: rereadEq }));
    const supabase = { from: vi.fn(() => ({ select, update })) };
    return { eq, rereadEq, select, supabase, update };
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
    expect(row.metadata[VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]).toEqual(
      expect.any(String)
    );
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
});
