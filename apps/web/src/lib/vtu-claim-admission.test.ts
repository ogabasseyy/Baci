import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
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
const USER_ID = 'user-1';

function verdictRow(
  verdict: 'fresh' | 'owned' | 'foreign',
  row: ExistingIdempotencyRow | null
) {
  return {
    verdict,
    key: 'key-1',
    vtu_transaction_id: row?.vtu_transaction_id ?? null,
    customer_id: row?.customer_id ?? null,
    merchant_id: row?.merchant_id ?? null,
    request_fingerprint: row?.request_fingerprint ?? null,
  };
}

function userClient({
  verdict = 'owned',
  row = ROW,
  error = null,
}: {
  verdict?: 'fresh' | 'owned' | 'foreign';
  row?: ExistingIdempotencyRow | null;
  error?: { message: string } | null;
} = {}): SupabaseClient {
  return {
    rpc: vi.fn(async () => ({
      data: error ? null : [verdictRow(verdict, row)],
      error,
    })),
  } as unknown as SupabaseClient;
}

function adminClient({
  proof = { admitted_at: STAMP, live_transaction_ids: [] as string[] },
  proofError = null,
  onProof,
}: {
  proof?: {
    admitted_at: string;
    live_transaction_ids: string[];
  } | null;
  proofError?: { message: string } | null;
  onProof?: (fn: string, args: unknown) => void;
} = {}): SupabaseClient {
  return {
    rpc: vi.fn(async (fn: string, args: unknown) => {
      onProof?.(fn, args);
      return { data: proof === null ? null : [proof], error: proofError };
    }),
  } as unknown as SupabaseClient;
}

describe('admitVtuClaim', () => {
  it('returns the owned row with the admission stamp and live set', async () => {
    const seen: Array<{ fn: string; args: unknown }> = [];

    const admission = await admitVtuClaim(
      userClient(),
      adminClient({
        proof: { admitted_at: STAMP, live_transaction_ids: ['txn-9'] },
        onProof: (fn, args) => seen.push({ fn, args }),
      }),
      'key-1',
      USER_ID,
      'store-1',
      'fp-1'
    );

    expect(admission).toEqual({
      existing: ROW,
      foreign: false,
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
      userClient({ verdict: 'fresh', row: null }),
      adminClient(),
      'key-fresh',
      USER_ID,
      'store-1',
      'fp-1'
    );

    expect(admission.existing).toBeNull();
    expect(admission.foreign).toBe(false);
    expect(admission.proof).toEqual({ admittedAt: STAMP, admissionLive: [] });
  });

  it('flags a foreign key instead of returning its row', async () => {
    const admission = await admitVtuClaim(
      userClient({ verdict: 'foreign', row: null }),
      adminClient(),
      'key-1',
      USER_ID,
      'store-1',
      'fp-1'
    );

    expect(admission.existing).toBeNull();
    expect(admission.foreign).toBe(true);
    expect(admission.proof?.admittedAt).toBe(STAMP);
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
    const user = {
      rpc: async () => {
        markIssued('lookup');
        await bothIssued;
        return { data: [verdictRow('fresh', null)], error: null };
      },
    } as unknown as SupabaseClient;
    const admin = {
      rpc: async () => {
        markIssued('rpc');
        await bothIssued;
        return {
          data: [{ admitted_at: STAMP, live_transaction_ids: [] }],
          error: null,
        };
      },
    } as unknown as SupabaseClient;

    const admission = await admitVtuClaim(
      user,
      admin,
      'key-1',
      USER_ID,
      'store-1',
      'fp-1'
    );

    expect(issued.sort()).toEqual(['lookup', 'rpc']);
    expect(admission.proof?.admittedAt).toBe(STAMP);
  });

  it('fails closed with VtuAdmissionError when the proof errors', async () => {
    await expect(
      admitVtuClaim(
        userClient({ verdict: 'fresh', row: null }),
        adminClient({ proofError: { message: 'db down' } }),
        'key-fresh',
        USER_ID,
        'store-1',
        'fp-1'
      )
    ).rejects.toBeInstanceOf(VtuAdmissionError);
  });

  it('fails closed with VtuAdmissionError when no proof is returned', async () => {
    await expect(
      admitVtuClaim(
        userClient({ verdict: 'fresh', row: null }),
        adminClient({ proof: null }),
        'key-fresh',
        USER_ID,
        'store-1',
        'fp-1'
      )
    ).rejects.toThrow('no admission proof returned');
  });

  it('returns a foreign key without the admission proof', async () => {
    // A foreign key 400s at the route before claiming, so it never
    // needs the proof — no 500 during a proof-RPC outage.
    const admission = await admitVtuClaim(
      userClient({ verdict: 'foreign', row: null }),
      adminClient({ proofError: { message: 'db down' } }),
      'key-1',
      USER_ID,
      'store-1',
      'fp-1'
    );

    expect(admission.existing).toBeNull();
    expect(admission.foreign).toBe(true);
    expect(admission.proof).toBeNull();
  });

  it('replays an existing row without the admission proof', async () => {
    // Codex P2: a proof-RPC outage must not lock customers out of
    // retrieving an already-debited result — the replay path never
    // uses the stamp or the live set, so an existing row short-
    // circuits with null proof fields.
    const admission = await admitVtuClaim(
      userClient(),
      adminClient({ proofError: { message: 'db down' } }),
      'key-1',
      USER_ID,
      'store-1',
      'fp-1'
    );

    expect(admission.existing).toEqual(ROW);
    expect(admission.foreign).toBe(false);
    expect(admission.proof).toBeNull();
  });

  it('propagates key-lookup failures unchanged', async () => {
    await expect(
      admitVtuClaim(
        userClient({ error: { message: 'lookup boom' } }),
        adminClient(),
        'key-1',
        USER_ID,
        'store-1',
        'fp-1'
      )
    ).rejects.toThrow('Failed to look up idempotency key: lookup boom');
  });
});
