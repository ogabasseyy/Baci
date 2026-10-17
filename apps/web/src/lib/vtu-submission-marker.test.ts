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
    updatedRow: { id: string; updated_at?: string } | null = updateError
      ? null
      : { id: 'vtu-1' }
  ) {
    // Chainable eq: the CAS write filters id + status (+ updated_at)
    // then selects the matched row id (Codex R94 P1).
    const eq: ReturnType<typeof vi.fn> = vi.fn(() => ({ eq, select }));
    const update: ReturnType<typeof vi.fn> = vi.fn(() => ({ eq }));
    const updateMaybeSingle = vi.fn(() =>
      Promise.resolve({ data: updatedRow, error: updateError })
    );
    const rereadMaybeSingle = vi.fn(() => Promise.resolve(reread));
    const rereadEq = vi.fn(() => ({ maybeSingle: rereadMaybeSingle }));
    const select = vi.fn((columns: string) =>
      columns === 'id, updated_at'
        ? { maybeSingle: updateMaybeSingle }
        : { eq: rereadEq }
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
    // No prior attempt errored, so no re-read is needed (R104 P1).
    const { rereadEq, select, supabase, update } = createSupabase(
      null,
      undefined,
      null
    );
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
    expect(select).toHaveBeenCalledWith('id, updated_at');
    expect(rereadEq).not.toHaveBeenCalled();
  });

  it('re-reads a zero-match retry and adopts our committed marker', async () => {
    // Codex R104 P1: attempt 1 committed but its response AND
    // read-back failed, so attempt 2 zero-matches on OUR token
    // advance — re-read and adopt instead of declaring a lost race
    // (which would restore with the stale token, match nothing,
    // and strand a debited row with a marker but no submission).
    const { rereadMaybeSingle, supabase, update, updateMaybeSingle } =
      createSupabase({ message: 'timeout' });
    updateMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'timeout' },
    });
    rereadMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'reread failed' },
    });
    updateMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    rereadMaybeSingle.mockImplementation(() => {
      const sent = update.mock.calls[0]?.[0] as unknown as {
        metadata: Record<string, unknown>;
      };
      return Promise.resolve({
        data: {
          metadata: {
            walletDebited: true,
            [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]:
              sent.metadata[VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY],
          },
          status: 'processing',
          transaction_id: null,
          updated_at: 'tok-2',
        },
        error: null,
      });
    });
    const row: {
      id: string;
      metadata: Record<string, unknown>;
      updated_at: string;
    } = {
      id: 'vtu-1',
      metadata: { walletDebited: true },
      updated_at: 'tok-1',
    };

    const result = await markVtuProviderSubmissionStarted({
      row,
      supabase: supabase as never,
    });

    expect(result).toBeNull();
    expect(update).toHaveBeenCalledTimes(2);
    const sentMarker = (
      update.mock.calls[0]?.[0] as unknown as {
        metadata: Record<string, unknown>;
      }
    ).metadata[VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY];
    expect(row.metadata[VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]).toBe(
      sentMarker
    );
    expect(row.updated_at).toBe('tok-2');
  });

  it('declares a lost race when the zero-match re-read shows a rival marker', async () => {
    // Codex R104 P1: the re-read disambiguates — a foreign marker
    // means a genuine race, so fail closed without refreshing the
    // token (our stale snapshot must not clobber the mover's keys).
    const { rereadMaybeSingle, supabase, updateMaybeSingle } = createSupabase({
      message: 'timeout',
    });
    updateMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'timeout' },
    });
    rereadMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'reread failed' },
    });
    updateMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    rereadMaybeSingle.mockResolvedValueOnce({
      data: {
        metadata: {
          walletDebited: true,
          [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]: '2020-01-01T00:00:00.000Z',
        },
        status: 'processing',
        transaction_id: null,
        updated_at: 'tok-rival',
      },
      error: null,
    });
    const row: {
      id: string;
      metadata: Record<string, unknown>;
      updated_at: string;
    } = {
      id: 'vtu-1',
      metadata: { walletDebited: true },
      updated_at: 'tok-1',
    };

    const result = await markVtuProviderSubmissionStarted({
      row,
      supabase: supabase as never,
    });

    expect(result).toEqual({
      message: 'VTU provider-submission marker lost race: row moved or settled',
    });
    expect(row.metadata).toEqual({ walletDebited: true });
    expect(row.updated_at).toBe('tok-1');
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
    // re-read marker EQUALS this invocation's generated value, so
    // with no response reference it is provably this worker's — no
    // provider call ran on the linear path here — adopt it and
    // proceed to the vend instead of stranding the row. The re-read
    // resolves dynamically from the attempted write's own marker
    // (Codex R96 P1 ownership).
    const { rereadEq, rereadMaybeSingle, select, supabase, update } =
      createSupabase({ message: 'timeout' });
    rereadMaybeSingle.mockImplementation(() => {
      const sent = update.mock.calls[0]?.[0] as unknown as {
        metadata: Record<string, unknown>;
      };
      return Promise.resolve({
        data: {
          metadata: {
            walletDebited: true,
            [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]:
              sent.metadata[VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY],
          },
          status: 'processing',
          transaction_id: null,
          updated_at: 'tok-2',
        },
        error: null,
      });
    });
    const row: {
      id: string;
      metadata: Record<string, unknown>;
      updated_at: string;
    } = {
      id: 'vtu-1',
      metadata: { walletDebited: true },
      updated_at: 'tok-1',
    };

    const result = await markVtuProviderSubmissionStarted({
      row,
      supabase: supabase as never,
    });

    expect(result).toBeNull();
    expect(select).toHaveBeenCalledWith(
      'metadata, status, transaction_id, updated_at'
    );
    expect(rereadEq).toHaveBeenCalledWith('id', 'vtu-1');
    const sentMarker = (
      update.mock.calls[0]?.[0] as unknown as {
        metadata: Record<string, unknown>;
      }
    ).metadata[VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY];
    expect(row.metadata[VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]).toBe(
      sentMarker
    );
    expect(row.updated_at).toBe('tok-2');
  });

  it('rejects a re-read marker written by another worker', async () => {
    // Codex R96 P1: our write failed after a long pause; meanwhile
    // stale recovery restored the row and a replay reclaimed it and
    // wrote ITS marker. The value differs from ours — adopting would
    // let both workers vend. Fail closed without retrying (our token
    // is stale, so a retry CAS could not match anyway).
    const { supabase, update } = createSupabase(
      { message: 'timeout' },
      {
        data: {
          metadata: {
            walletDebited: true,
            [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]:
              '2020-01-01T00:00:00.000Z',
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

    expect(result).toEqual({ message: 'timeout' });
    expect(row.metadata).toEqual({ walletDebited: true });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('refreshes the CAS token when the marker write lands', async () => {
    // Codex R96 P1: the marker write advances updated_at — downstream
    // CAS writes (Kuda fallback marker) need the fresh token.
    const { supabase, updateMaybeSingle } = createSupabase(null);
    updateMaybeSingle.mockResolvedValueOnce({
      data: { id: 'vtu-1', updated_at: 'tok-2' },
      error: null,
    });
    const row: {
      id: string;
      metadata: Record<string, unknown>;
      updated_at: string;
    } = {
      id: 'vtu-1',
      metadata: { walletDebited: true },
      updated_at: 'tok-1',
    };

    const result = await markVtuProviderSubmissionStarted({
      row,
      supabase: supabase as never,
    });

    expect(result).toBeNull();
    expect(row.updated_at).toBe('tok-2');
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
    // and proceed instead of restoring with a dead token. The marker
    // resolves from the attempted write's own value (R96 ownership).
    const { rereadMaybeSingle, supabase, update } = createSupabase({
      message: 'timeout',
    });
    rereadMaybeSingle
      .mockResolvedValueOnce({ data: null, error: { message: 'db down' } })
      .mockImplementationOnce(() => {
        const sent = update.mock.calls[0]?.[0] as unknown as {
          metadata: Record<string, unknown>;
        };
        return Promise.resolve({
          data: {
            metadata: {
              walletDebited: true,
              [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]:
                sent.metadata[VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY],
            },
            status: 'processing',
            transaction_id: null,
          },
          error: null,
        });
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
    const sentMarker = (
      update.mock.calls[0]?.[0] as unknown as {
        metadata: Record<string, unknown>;
      }
    ).metadata[VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY];
    expect(row.metadata[VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]).toBe(
      sentMarker
    );
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
