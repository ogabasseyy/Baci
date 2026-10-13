import { describe, expect, it, vi } from 'vitest';
import {
  isFlaggedReferenceLessVtuRow,
  isMarkedUnsubmittedMonnifyVtuRow,
  isUnsubmittedPreparedVtuRow,
  markVtuProviderSubmissionStarted,
  STRANDED_UNSUBMITTED_MIN_CREATED_MS,
  VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY,
} from './vtu-flagged-recovery';
import { STRANDED_PRE_VEND_STALE_MS } from './vtu-pre-vend-recovery';

describe('isFlaggedReferenceLessVtuRow', () => {
  const staleAt = new Date(
    Date.now() - STRANDED_PRE_VEND_STALE_MS - 1000
  ).toISOString();
  const freshAt = new Date(Date.now() - 1000).toISOString();
  const base = {
    id: 'vtu-1',
    status: 'processing' as const,
    transaction_id: null,
    error_message: null,
    request_reference: 'VTU-REQ-1',
    updated_at: staleAt,
  };

  it('flags a stale debited Kuda row carrying only the request reference', () => {
    // Post-vend persist failure: the flag proves the debit landed,
    // and Kuda BILL_TSQ resolves by BillRequestRef, so provider
    // truth can settle the row without ever re-vending.
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        metadata: { walletDebited: true },
      })
    ).toBe(true);
  });

  it('flags a Kuda-fallback row via its pre-persisted provider switch', () => {
    // Monnify-airtime fallback persists provider=kuda BEFORE the Kuda
    // call, so a result-persist crash still leaves a Kuda-routable
    // row: Kuda TSQ resolves by request_reference even though the row
    // started life as Monnify and carries no Monnify vend reference.
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        metadata: {
          fulfillmentProvider: 'kuda',
          monnifyFallbackError: 'Monnify API error: 400',
          originalProvider: 'monnify',
          provider: 'kuda',
          providerFallback: 'monnify_airtime_to_kuda',
          walletDebited: true,
        },
      })
    ).toBe(true);
  });

  it('flags a stale debited Monnify row carrying its vend reference', () => {
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        request_reference: null,
        metadata: {
          provider: 'monnify',
          walletDebited: true,
          monnifyVendReference: 'VEND-1',
        },
      })
    ).toBe(true);
  });

  it('declines rows without the requery key for their route', () => {
    // Kuda without a request reference: the keyless status call
    // reports failed, which would wrongfully fail/refund. Monnify
    // without a vend reference: requery cannot run at all.
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        request_reference: '  ',
        metadata: { walletDebited: true },
      })
    ).toBe(false);
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        metadata: { provider: 'monnify', walletDebited: true },
      })
    ).toBe(false);
  });

  it('declines rows a live worker could still hold', () => {
    // A mid-flight vend misread as failed would refund while value
    // lands — only stale rows requery.
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        metadata: { walletDebited: true },
        updated_at: freshAt,
      })
    ).toBe(false);
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        metadata: { walletDebited: true },
        updated_at: null,
      })
    ).toBe(false);
  });

  it('declines unflagged rows and rows the claim already handles', () => {
    // Unflagged: pre-vend recovery's domain (mutually exclusive by
    // the flag). With references: the normal claim path.
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        metadata: { paymentSplit: { wallet: 1000, card: 0 } },
      })
    ).toBe(false);
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        transaction_id: 'PROV-1',
        metadata: { walletDebited: true },
      })
    ).toBe(false);
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        error_message: 'provider said maybe',
        metadata: { walletDebited: true },
      })
    ).toBe(false);
    expect(
      isFlaggedReferenceLessVtuRow({
        ...base,
        status: 'pending',
        metadata: { walletDebited: true },
      })
    ).toBe(false);
  });
});

describe('isUnsubmittedPreparedVtuRow', () => {
  const staleAt = new Date(
    Date.now() - STRANDED_PRE_VEND_STALE_MS - 1000
  ).toISOString();
  const freshAt = new Date(Date.now() - 1000).toISOString();
  const markerEraAt = new Date(
    STRANDED_UNSUBMITTED_MIN_CREATED_MS + 1000
  ).toISOString();
  const preMarkerAt = new Date(
    STRANDED_UNSUBMITTED_MIN_CREATED_MS - 1000
  ).toISOString();
  const base = {
    created_at: markerEraAt,
    error_message: null,
    id: 'vtu-1',
    metadata: { walletDebited: true },
    request_reference: 'VTU-REQ-1',
    status: 'processing' as const,
    transaction_id: null,
    updated_at: staleAt,
  };

  it('recovers a stale debited marker-era row with no submission marker', () => {
    // Crash between the debit persist and the first provider call:
    // marker absence proves no submission ran, so the row re-drives
    // with the same reference instead of requerying unknown forever.
    expect(isUnsubmittedPreparedVtuRow(base)).toBe(true);
  });

  it('declines any row carrying the submission marker, even malformed', () => {
    // Submitted (or ambiguous): the requery-only flagged path owns
    // these — re-driving could double-credit.
    for (const marker of [
      new Date().toISOString(),
      '',
      0,
      null,
      { nested: 'object' },
    ]) {
      expect(
        isUnsubmittedPreparedVtuRow({
          ...base,
          metadata: {
            walletDebited: true,
            [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]: marker,
          },
        })
      ).toBe(false);
    }
  });

  it('declines pre-marker-era rows whose marker absence proves nothing', () => {
    // Legacy purchases never knew the marker: a landed vend looks
    // identical to a crash strand, so these stay requery-only.
    expect(
      isUnsubmittedPreparedVtuRow({ ...base, created_at: preMarkerAt })
    ).toBe(false);
    expect(isUnsubmittedPreparedVtuRow({ ...base, created_at: null })).toBe(
      false
    );
  });

  it('declines rows with submitted evidence or a live worker', () => {
    expect(
      isUnsubmittedPreparedVtuRow({
        ...base,
        metadata: {
          monnifyVendReference: 'VEND-1',
          walletDebited: true,
        },
      })
    ).toBe(false);
    expect(
      isUnsubmittedPreparedVtuRow({
        ...base,
        transaction_id: 'PROV-1',
      })
    ).toBe(false);
    expect(
      isUnsubmittedPreparedVtuRow({
        ...base,
        error_message: 'provider said maybe',
      })
    ).toBe(false);
    expect(isUnsubmittedPreparedVtuRow({ ...base, updated_at: freshAt })).toBe(
      false
    );
    expect(
      isUnsubmittedPreparedVtuRow({
        ...base,
        metadata: { paymentSplit: { card: 0, wallet: 1000 } },
      })
    ).toBe(false);
  });
});

describe('isMarkedUnsubmittedMonnifyVtuRow', () => {
  const staleAt = new Date(
    Date.now() - STRANDED_PRE_VEND_STALE_MS - 1000
  ).toISOString();
  const freshAt = new Date(Date.now() - 1000).toISOString();
  const base = {
    created_at: new Date(Date.now() - 1000).toISOString(),
    error_message: null,
    id: 'vtu-1',
    metadata: {
      provider: 'monnify',
      walletDebited: true,
      [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]: new Date().toISOString(),
    },
    request_reference: 'VTU-REQ-1',
    status: 'processing' as const,
    transaction_id: null,
    updated_at: staleAt,
  };

  it('recovers a stale marked Monnify row with no response reference', () => {
    // Crash between the marker persist and the provider call: the
    // row can neither re-drive (unsubmitted needs marker absence)
    // nor requery (Monnify needs a response vendReference), so
    // restore re-drives with the same reference — the same dedupe
    // assumption the transient-vend path already makes.
    expect(isMarkedUnsubmittedMonnifyVtuRow(base)).toBe(true);
  });

  it('declines Kuda rows, which have no re-vend dedupe evidence', () => {
    expect(
      isMarkedUnsubmittedMonnifyVtuRow({
        ...base,
        metadata: { ...base.metadata, provider: 'kuda' },
      })
    ).toBe(false);
    expect(
      isMarkedUnsubmittedMonnifyVtuRow({
        ...base,
        metadata: { walletDebited: true },
      })
    ).toBe(false);
  });

  it('declines mid-fallback crashes via the pre-persisted provider switch', () => {
    // The Kuda fallback overwrites provider to 'kuda' before
    // dispatching: a crash past that point may have submitted to
    // Kuda, so these stay requery-only instead of re-driving.
    expect(
      isMarkedUnsubmittedMonnifyVtuRow({
        ...base,
        metadata: {
          ...base.metadata,
          fulfillmentProvider: 'kuda',
          provider: 'kuda',
          providerFallback: 'monnify_airtime_to_kuda',
        },
      })
    ).toBe(false);
  });

  it('declines submitted evidence, marker absence, and live workers', () => {
    expect(
      isMarkedUnsubmittedMonnifyVtuRow({
        ...base,
        transaction_id: 'PROV-1',
      })
    ).toBe(false);
    expect(
      isMarkedUnsubmittedMonnifyVtuRow({
        ...base,
        metadata: { ...base.metadata, monnifyVendReference: 'VEND-1' },
      })
    ).toBe(false);
    expect(
      isMarkedUnsubmittedMonnifyVtuRow({
        ...base,
        metadata: { provider: 'monnify', walletDebited: true },
      })
    ).toBe(false);
    expect(
      isMarkedUnsubmittedMonnifyVtuRow({
        ...base,
        error_message: 'provider said maybe',
      })
    ).toBe(false);
    expect(
      isMarkedUnsubmittedMonnifyVtuRow({ ...base, updated_at: freshAt })
    ).toBe(false);
    expect(
      isMarkedUnsubmittedMonnifyVtuRow({
        ...base,
        metadata: {
          provider: 'monnify',
          [VTU_PROVIDER_SUBMISSION_STARTED_AT_KEY]: new Date().toISOString(),
        },
      })
    ).toBe(false);
  });
});

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
