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

function fakeClient({
  row = null,
  rowError = null,
  stamp = '2026-10-20T06:00:00.000Z',
  stampError = null,
  onRpc,
  onLookup,
}: {
  row?: ExistingIdempotencyRow | null;
  rowError?: { message: string } | null;
  stamp?: string | null;
  stampError?: { message: string } | null;
  onRpc?: (fn: string) => void;
  onLookup?: () => void;
} = {}): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            onLookup?.();
            return { data: row, error: rowError };
          },
        }),
      }),
    }),
    rpc: async (fn: string) => {
      onRpc?.(fn);
      return { data: stamp, error: stampError };
    },
  } as unknown as SupabaseClient;
}

describe('admitVtuClaim', () => {
  it('returns the existing row with the DB-clock admission stamp', async () => {
    const seen: string[] = [];

    const admission = await admitVtuClaim(
      fakeClient({ row: ROW, onRpc: (fn) => seen.push(fn) }),
      'key-1'
    );

    expect(admission).toEqual({
      existing: ROW,
      admittedAt: '2026-10-20T06:00:00.000Z',
    });
    expect(seen).toEqual(['vtu_admission_timestamp']);
  });

  it('admits a fresh key with a null existing row', async () => {
    const admission = await admitVtuClaim(fakeClient(), 'key-fresh');

    expect(admission.existing).toBeNull();
    expect(admission.admittedAt).toBe('2026-10-20T06:00:00.000Z');
  });

  it('issues the lookup and the stamp concurrently', async () => {
    // Codex R3 P1: the stamp must not add latency, and the
    // admission instant must coincide with the key read. Each
    // side waits for the other to be issued before resolving —
    // a sequential implementation deadlocks and times out.
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
        return { data: '2026-10-20T06:00:00.000Z', error: null };
      },
    } as unknown as SupabaseClient;

    const admission = await admitVtuClaim(client, 'key-1');

    expect(issued.sort()).toEqual(['lookup', 'rpc']);
    expect(admission.admittedAt).toBe('2026-10-20T06:00:00.000Z');
  });

  it('fails closed with VtuAdmissionError when the stamp errors', async () => {
    await expect(
      admitVtuClaim(
        fakeClient({ row: ROW, stampError: { message: 'db down' } }),
        'key-1'
      )
    ).rejects.toBeInstanceOf(VtuAdmissionError);
  });

  it('fails closed with VtuAdmissionError when no stamp is returned', async () => {
    await expect(
      admitVtuClaim(fakeClient({ row: ROW, stamp: null }), 'key-1')
    ).rejects.toThrow('no timestamp returned');
  });

  it('propagates key-lookup failures unchanged', async () => {
    await expect(
      admitVtuClaim(
        fakeClient({ rowError: { message: 'lookup boom' } }),
        'key-1'
      )
    ).rejects.toThrow('Failed to look up idempotency key: lookup boom');
  });
});
