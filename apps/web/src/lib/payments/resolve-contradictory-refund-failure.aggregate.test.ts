import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  quarantineRefund: vi.fn(),
}));

vi.mock('@/lib/orders/quarantine-order-cancellation-refund', () => ({
  quarantineRefund: mocks.quarantineRefund,
}));

import { DeliveryUncertainError } from '@/lib/orders/run-order-cancellation-side-effect';
import { resolveContradictoryRefundFailure } from './resolve-contradictory-refund-failure';
import {
  chain,
  order,
  row,
} from './resolve-contradictory-refund-failure.test-support';

function failedRow(overrides: Record<string, unknown> = {}) {
  return {
    amount: 100,
    created_at: '2026-09-27T12:00:00Z',
    currency: 'NGN',
    gateway: 'paystack',
    gateway_reference: 'RFD-1',
    id: 'refund-1',
    metadata: {
      payment_transaction_id: 'payment-1',
      provider_refund_status: 'failed',
    },
    ...overrides,
  };
}

function replacement(overrides: Record<string, unknown> = {}) {
  return {
    amount: 50,
    created_at: '2026-09-27T13:00:00Z',
    currency: 'NGN',
    gateway: 'paystack',
    id: 'refund-2',
    metadata: { payment_transaction_id: 'payment-1' },
    ...overrides,
  };
}

describe('resolveContradictoryRefundFailure aggregate coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.quarantineRefund.mockRejectedValue(
      new DeliveryUncertainError('quarantined')
    );
  });

  it('suppresses the alert when split replacements sum to the failed amount', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: [failedRow()], error: null }, 'limit'))
      .mockReturnValueOnce(
        chain(
          {
            data: [
              replacement({ id: 'refund-2' }),
              replacement({ id: 'refund-3' }),
            ],
            error: null,
          },
          'limit'
        )
      );

    await expect(
      resolveContradictoryRefundFailure({ from } as never, row, order)
    ).resolves.toBe(true);
    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
  });

  it('files when matching replacements sum below the failed amount', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: [failedRow()], error: null }, 'limit'))
      .mockReturnValueOnce(
        chain({ data: [replacement({ id: 'refund-2' })], error: null }, 'limit')
      )
      .mockReturnValueOnce(chain({ data: [], error: null }, 'in'));

    await expect(
      resolveContradictoryRefundFailure({ from } as never, row, order)
    ).resolves.toBe(false);
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          contradictory_refund_failure: true,
          failed_refund_ids: ['refund-1'],
        }),
      })
    );
  });

  it('ignores replacements on other legs, gateways, or currencies', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: [failedRow()], error: null }, 'limit'))
      .mockReturnValueOnce(
        chain(
          {
            data: [
              replacement({
                id: 'refund-2',
                metadata: { payment_transaction_id: 'payment-9' },
              }),
              replacement({ currency: 'USD', id: 'refund-3' }),
              replacement({ gateway: 'korapay', id: 'refund-4' }),
              replacement({ amount: 100, id: 'refund-5' }),
            ],
            error: null,
          },
          'limit'
        )
      );

    // Only refund-5 matches the failed leg, and its 100 covers the 100.
    await expect(
      resolveContradictoryRefundFailure({ from } as never, row, order)
    ).resolves.toBe(true);
    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
  });

  it('keeps an earlier replacement when a later failure resets the notification clock', async () => {
    // Leg A fails at 10:00 and is replaced at 11:00; leg B fails at
    // 14:00, resetting the shared notification row to 15:00, and is
    // replaced at 14:30. Timing against the notification row would
    // exclude A's valid replacement and alert falsely; per-leg timing
    // covers both.
    const resetRow = { ...row, created_at: '2026-09-27T15:00:00Z' };
    const from = vi
      .fn()
      .mockReturnValueOnce(
        chain(
          {
            data: [
              failedRow({ created_at: '2026-09-27T10:00:00Z' }),
              failedRow({
                created_at: '2026-09-27T14:00:00Z',
                gateway_reference: 'RFD-3',
                id: 'refund-3',
                metadata: {
                  payment_transaction_id: 'payment-3',
                  provider_refund_status: 'failed',
                },
              }),
            ],
            error: null,
          },
          'limit'
        )
      )
      .mockReturnValueOnce(
        chain(
          {
            data: [
              replacement({
                amount: 100,
                created_at: '2026-09-27T11:00:00Z',
                id: 'refund-2',
              }),
              replacement({
                amount: 100,
                created_at: '2026-09-27T14:30:00Z',
                id: 'refund-4',
                metadata: { payment_transaction_id: 'payment-3' },
              }),
            ],
            error: null,
          },
          'limit'
        )
      );

    await expect(
      resolveContradictoryRefundFailure({ from } as never, resetRow, order)
    ).resolves.toBe(true);
    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
  });

  it('ignores replacements that predate their failed leg', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: [failedRow()], error: null }, 'limit'))
      .mockReturnValueOnce(
        chain(
          {
            data: [
              replacement({
                amount: 100,
                created_at: '2026-09-27T11:00:00Z',
                id: 'refund-2',
              }),
            ],
            error: null,
          },
          'limit'
        )
      )
      .mockReturnValueOnce(chain({ data: [], error: null }, 'in'));

    // The 11:00 replacement predates the 12:00 failure, so it cannot
    // supersede it — the contradiction files.
    await expect(
      resolveContradictoryRefundFailure({ from } as never, row, order)
    ).resolves.toBe(false);
    expect(mocks.quarantineRefund).toHaveBeenCalled();
  });

  it('fails closed when a matching replacement amount is malformed', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: [failedRow()], error: null }, 'limit'))
      .mockReturnValueOnce(
        chain(
          {
            data: [
              replacement({ amount: 'not-a-number', id: 'refund-2' }),
              replacement({ amount: 100, id: 'refund-3' }),
            ],
            error: null,
          },
          'limit'
        )
      )
      .mockReturnValueOnce(chain({ data: [], error: null }, 'in'));

    await expect(
      resolveContradictoryRefundFailure({ from } as never, row, order)
    ).resolves.toBe(false);
    expect(mocks.quarantineRefund).toHaveBeenCalled();
  });
});
