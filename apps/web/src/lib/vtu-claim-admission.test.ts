import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { admitVtuClaim, VtuAdmissionError } from './vtu-claim-admission';
import type { ExistingIdempotencyRow } from './vtu-idempotency-key-lookup';

const ROW: ExistingIdempotencyRow = {
  key: 'key-1',
  vtu_transaction_id: 'txn-1',
  customer_id: 'cust-1',
  merchant_id: 'merch-1',
  request_fingerprint: 'fp-1',
};

const STAMP = '2026-10-20T06:00:00.000Z';

function fakeClient({
  row = null,
  rowError = null,
  proof = { admitted_at: STAMP, live_transaction_ids: [] as string[] },
  proofError = null,
  onProof,
}: {
  row?: ExistingIdempotencyRow | null;
  rowError?: { message: string } | null;
  proof?: {
    admitted_at: string;
    live_transaction_ids: string[];
  } | null;
  proofError?: { message: string } | null;
  onProof?: (fn: string, args: unknown) => void;
} = {}): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: rowError }),
        }),
      }),
    }),
    rpc: async (fn: string, args: unknown) => {
      onProof?.(fn, args);
      return { data: proof === null ? null : [proof], error: proofError };
    },
  } as unknown as SupabaseClient;
}

describe('admitVtuClaim', () => {
  it('returns the existing row with the admission stamp and live set', async () => {
    const seen: Array<{ fn: string; args: unknown }> = [];

    const admission = await admitVtuClaim(
      fakeClient({
        row: ROW,
        proof: { admitted_at: STAMP, live_transaction_ids: ['txn-9'] },
        onProof: (fn, args) => seen.push({ fn, args }),
      }),
      'key-1',
      'store-1',
      'fp-1'
    );

    expect(admission).toEqual({
      existing: ROW,
      proof: { admittedAt: STAMP, admissionLive: ['txn-9'] },
    });
    expect(seen).toEqual([
      {
        fn: 'vtu_admission_proof',
        args: { p_merchant_slug: 'store-1', p_fingerprint: 'fp-1' },
      },
    ]);
  });

  it('admits a fresh key with a null existing row and empty live set', async () => {
    const admission = await admitVtuClaim(
      fakeClient(),
      'key-fresh',
      'store-1',
      'fp-1'
    );

    expect(admission.existing).toBeNull();
    expect(admission.proof).toEqual({ admittedAt: STAMP, admissionLive: [] });
  });

  it('issues the lookup and the proof concurrently', async () => {
    // Codex R3 P1: admission must not add latency — both
    // requests are in flight before either resolves. A sequential
    // implementation deadlocks and times out.
    const issued: string[] = [];
    let release!: () => void;
    const bothIssued = new Promise<void>((resolve) => {
      release = resolve;
    });
    const markIssued = (name: string) => {
      issued.push(name);
      if (issued.length === 2) release();
    };
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              markIssued('lookup');
              await bothIssued;
              return { data: null, error: null };
            },
          }),
        }),
      }),
      rpc: async () => {
        markIssued('rpc');
        await bothIssued;
        return {
          data: [{ admitted_at: STAMP, live_transaction_ids: [] }],
          error: null,
        };
      },
    } as unknown as SupabaseClient;

    const admission = await admitVtuClaim(client, 'key-1', 'store-1', 'fp-1');

    expect(issued.sort()).toEqual(['lookup', 'rpc']);
    expect(admission.proof?.admittedAt).toBe(STAMP);
  });

  it('fails closed with VtuAdmissionError when the proof errors', async () => {
    await expect(
      admitVtuClaim(
        fakeClient({ proofError: { message: 'db down' } }),
        'key-fresh',
        'store-1',
        'fp-1'
      )
    ).rejects.toBeInstanceOf(VtuAdmissionError);
  });

  it('fails closed with VtuAdmissionError when no proof is returned', async () => {
    await expect(
      admitVtuClaim(fakeClient({ proof: null }), 'key-fresh', 'store-1', 'fp-1')
    ).rejects.toThrow('no admission proof returned');
  });

  it('replays an existing row without the admission proof', async () => {
    // Codex P2: a proof-RPC outage must not lock customers out of
    // retrieving an already-debited result — the replay path never
    // uses the stamp or the live set, so an existing row short-
    // circuits with null proof fields.
    const admission = await admitVtuClaim(
      fakeClient({ row: ROW, proofError: { message: 'db down' } }),
      'key-1',
      'store-1',
      'fp-1'
    );

    expect(admission.existing).toEqual(ROW);
    expect(admission.proof).toBeNull();
  });

  it('propagates key-lookup failures unchanged', async () => {
    await expect(
      admitVtuClaim(
        fakeClient({ rowError: { message: 'lookup boom' } }),
        'key-1',
        'store-1',
        'fp-1'
      )
    ).rejects.toThrow('Failed to look up idempotency key: lookup boom');
  });
});
