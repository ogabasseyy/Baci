import { describe, expect, it, vi } from 'vitest';
import {
  type ConcurrentFailedRefundRow,
  resolveConcurrentFailedVtuTransaction,
} from './vtu-concurrent-failed-refund';
import { VtuPersistenceError } from './vtu-persistence-error';
import { RetryableVtuError } from './vtu-refund-guard';

type Supabase = Parameters<
  typeof resolveConcurrentFailedVtuTransaction
>[0]['supabase'];

const ROW: ConcurrentFailedRefundRow = {
  amount: 1000,
  customer_id: 'customer-1',
  error_message: 'vend failed',
  id: 'vtu-1',
  metadata: { walletDebited: true },
  request_reference: 'VTU-1',
  source: 'checkout',
};

function mockSupabase(updateError: { message: string } | null) {
  const statusEq = vi.fn(() => Promise.resolve({ error: updateError }));
  const idEq = vi.fn(() => ({ eq: statusEq }));
  const update = vi.fn(() => ({ eq: idEq }));
  const supabase = {
    from: vi.fn(() => ({ update })),
  } as unknown as Supabase;
  return { supabase, update };
}

describe('resolveConcurrentFailedVtuTransaction', () => {
  it('confirms the refund, persists changed metadata, and reports the restoration', async () => {
    const { supabase, update } = mockSupabase(null);
    const issueRefund = vi.fn(async (metadata: Record<string, unknown>) => {
      metadata.refundIssued = true;
      return {
        metadataChanged: true,
        refundIssued: true,
        refundedAmount: 1000,
      };
    });

    const result = await resolveConcurrentFailedVtuTransaction({
      issueRefund,
      row: ROW,
      supabase,
    });

    // Works on a copy: the caller's row metadata is untouched.
    expect(ROW.metadata).toEqual({ walletDebited: true });
    expect(update).toHaveBeenCalledWith({
      metadata: expect.objectContaining({ refundIssued: true }),
    });
    expect(result).toEqual({
      amount: 1000,
      error: 'vend failed',
      reference: 'VTU-1',
      refundedToWallet: 1000,
      status: 'failed',
    });
  });

  it('skips the metadata write when the issuer changed nothing', async () => {
    const { supabase, update } = mockSupabase(null);
    const issueRefund = vi.fn(async () => ({
      metadataChanged: false,
      refundIssued: true,
      refundedAmount: 0,
    }));

    const result = await resolveConcurrentFailedVtuTransaction({
      issueRefund,
      row: ROW,
      supabase,
    });

    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({
      amount: 1000,
      error: 'vend failed',
      reference: 'VTU-1',
      status: 'failed',
    });
  });

  it('throws VtuPersistenceError when the metadata write fails (fail-closed)', async () => {
    const { supabase } = mockSupabase({ message: 'db down' });
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const issueRefund = vi.fn(async () => ({
        metadataChanged: true,
        refundIssued: true,
        refundedAmount: 1000,
      }));

      await expect(
        resolveConcurrentFailedVtuTransaction({
          issueRefund,
          row: ROW,
          supabase,
        })
      ).rejects.toThrow(VtuPersistenceError);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('throws RetryableVtuError when a required refund stays unconfirmed', async () => {
    const { supabase } = mockSupabase(null);
    // Refund RPC failed: failed rows are cron-excluded, so returning
    // terminal here would strand the debit — the guard 5xxes instead.
    const issueRefund = vi.fn(async () => ({
      metadataChanged: false,
      refundIssued: false,
      refundedAmount: 0,
    }));

    await expect(
      resolveConcurrentFailedVtuTransaction({
        issueRefund,
        row: ROW,
        supabase,
      })
    ).rejects.toThrow(RetryableVtuError);
  });
});
