import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initiationOrder,
  initiationTransaction,
} from './initiate-paystack-cancellation-refunds.test-helpers';
import { recordPaystackCancellationRefund } from './record-paystack-cancellation-refund';

const mocks = vi.hoisted(() => ({
  quarantineRefund: vi.fn(),
}));

vi.mock('./quarantine-order-cancellation-refund', () => ({
  quarantineRefund: mocks.quarantineRefund,
}));

function acceptedRefund(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: 101,
      status: 'queued',
      transaction: { id: 55, reference: 'PSK-1' },
      ...overrides,
    },
    success: true as const,
  };
}

describe('recordPaystackCancellationRefund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.quarantineRefund.mockImplementation(() => {
      throw new Error('quarantined');
    });
  });

  function database({
    conflictRow = null,
    insertError = null,
  }: {
    conflictRow?: unknown;
    insertError?: unknown;
  } = {}) {
    const insert = vi.fn().mockResolvedValue({ error: insertError });
    const from = vi.fn().mockImplementation((table: string) => {
      if (table !== 'transactions') throw new Error(`unexpected ${table}`);
      return {
        insert,
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: conflictRow, error: null }),
        })),
      };
    });
    return {
      from,
      insert,
      supabase: { from } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>,
    };
  }

  it('audits an accepted refund and returns the provider id', async () => {
    const { insert, supabase } = database();

    const refundId = await recordPaystackCancellationRefund({
      order: initiationOrder,
      paystackRefund: acceptedRefund(),
      supabase,
      transaction: initiationTransaction,
      transactionAmount: 12.5,
    });

    expect(refundId).toBe(101);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway_reference: '101',
        metadata: expect.objectContaining({
          payment_transaction_id: 'tx-1',
          provider_payment_transaction_id: 55,
        }),
        status: 'refund_pending',
      })
    );
    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
  });

  it('quarantines an accept whose evidence does not match the leg', async () => {
    const { supabase } = database();

    await expect(
      recordPaystackCancellationRefund({
        order: initiationOrder,
        paystackRefund: acceptedRefund({
          transaction: { id: 55, reference: 'PSK-OTHER' },
        }),
        supabase,
        transaction: initiationTransaction,
        transactionAmount: 12.5,
      })
    ).rejects.toThrow('quarantined');

    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining('without matching payment evidence'),
      })
    );
  });

  it('treats a verified concurrent audit row as recorded', async () => {
    const { supabase } = database({
      conflictRow: {
        amount: 12.5,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: '101',
        id: 'other-row',
        metadata: { payment_transaction_id: 'tx-1' },
        transaction_type: 'refund',
      },
      insertError: { code: '23505' },
    });

    const refundId = await recordPaystackCancellationRefund({
      order: initiationOrder,
      paystackRefund: acceptedRefund(),
      supabase,
      transaction: initiationTransaction,
      transactionAmount: 12.5,
    });

    expect(refundId).toBe(101);
    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
  });

  it('accepts a legacy-cased conflicting audit row', async () => {
    const { supabase } = database({
      conflictRow: {
        amount: 12.5,
        currency: ' ngn ',
        gateway: ' Paystack ',
        gateway_reference: '101',
        id: 'other-row',
        metadata: { payment_transaction_id: 'tx-1' },
        transaction_type: 'refund',
      },
      insertError: { code: '23505' },
    });

    const refundId = await recordPaystackCancellationRefund({
      order: initiationOrder,
      paystackRefund: acceptedRefund(),
      supabase,
      transaction: initiationTransaction,
      transactionAmount: 12.5,
    });

    expect(refundId).toBe(101);
    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
  });

  it('quarantines when the conflicting row covers a different leg', async () => {
    const { supabase } = database({
      conflictRow: {
        amount: 12.5,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: '101',
        id: 'other-row',
        metadata: { payment_transaction_id: 'tx-other' },
        transaction_type: 'refund',
      },
      insertError: { code: '23505' },
    });

    await expect(
      recordPaystackCancellationRefund({
        order: initiationOrder,
        paystackRefund: acceptedRefund(),
        supabase,
        transaction: initiationTransaction,
        transactionAmount: 12.5,
      })
    ).rejects.toThrow('quarantined');

    // A legacy row reusing the provider refund ID on another leg must
    // not mark this leg audited: no retry would ever initiate this
    // leg's refund while the side effect completes.
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining('local audit record failed'),
      })
    );
  });

  it('quarantines when the conflicting row money does not match the leg', async () => {
    const { supabase } = database({
      conflictRow: {
        amount: 99,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: '101',
        id: 'other-row',
        metadata: { payment_transaction_id: 'tx-1' },
        transaction_type: 'refund',
      },
      insertError: { code: '23505' },
    });

    await expect(
      recordPaystackCancellationRefund({
        order: initiationOrder,
        paystackRefund: acceptedRefund(),
        supabase,
        transaction: initiationTransaction,
        transactionAmount: 12.5,
      })
    ).rejects.toThrow('quarantined');

    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining('local audit record failed'),
      })
    );
  });

  it('quarantines when the audit row cannot be recorded', async () => {
    const { supabase } = database({ insertError: { code: 'CONN' } });

    await expect(
      recordPaystackCancellationRefund({
        order: initiationOrder,
        paystackRefund: acceptedRefund(),
        supabase,
        transaction: initiationTransaction,
        transactionAmount: 12.5,
      })
    ).rejects.toThrow('quarantined');

    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          audit_record_failed: true,
          provider_refund_id: 101,
        }),
      })
    );
  });

  it.each([
    null,
    undefined,
    'ok',
  ])('quarantines delivery-uncertain when the success payload has no refund data (%s)', async (data) => {
    const { supabase } = database();

    await expect(
      recordPaystackCancellationRefund({
        order: initiationOrder,
        paystackRefund: { data, success: true } as never,
        supabase,
        transaction: initiationTransaction,
        transactionAmount: 12.5,
      })
    ).rejects.toThrow('quarantined');

    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          malformed_refund_response: true,
        }),
        reason: expect.stringContaining('without refund data'),
      })
    );
  });
});
