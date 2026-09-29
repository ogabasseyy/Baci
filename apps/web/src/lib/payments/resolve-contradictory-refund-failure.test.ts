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

describe('resolveContradictoryRefundFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.quarantineRefund.mockRejectedValue(
      new DeliveryUncertainError('quarantined')
    );
  });

  it('suppresses the alert when a replacement refund covers the failed leg', async () => {
    const failedRows = [
      {
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
      },
    ];
    const replacement = chain(
      {
        data: [
          {
            amount: 100,
            created_at: '2026-09-27T13:00:00Z',
            currency: 'NGN',
            gateway: 'paystack',
            id: 'refund-2',
            metadata: {
              payment_transaction_id: 'payment-1',
              provider_refund_status: 'processed',
            },
          },
        ],
        error: null,
      },
      'limit'
    );
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: failedRows, error: null }, 'limit'))
      .mockReturnValueOnce(replacement);

    await expect(
      resolveContradictoryRefundFailure({ from } as never, row, order)
    ).resolves.toBe(true);
    // Timing is evaluated per failed leg in code, not against the
    // shared notification timestamp: both queries fetch created_at and
    // no longer floor on the notification row.
    expect(replacement.select).toHaveBeenCalledWith(
      expect.stringContaining('created_at')
    );
    expect(replacement.gt).not.toHaveBeenCalled();
    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
  });

  it('files when the only replacement covers a different payment leg', async () => {
    const failedRows = [
      {
        amount: 100,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: 'RFD-1',
        id: 'refund-1',
        metadata: {
          payment_transaction_id: 'payment-1',
          provider_refund_status: 'failed',
        },
      },
    ];
    const legs = [
      {
        amount: 100,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: 'PSK-1',
        id: 'payment-1',
      },
    ];
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: failedRows, error: null }, 'limit'))
      .mockReturnValueOnce(
        chain(
          {
            data: [
              {
                amount: 200,
                currency: 'NGN',
                gateway: 'paystack',
                id: 'refund-2',
                metadata: {
                  payment_transaction_id: 'payment-2',
                  provider_refund_status: 'processed',
                },
              },
            ],
            error: null,
          },
          'limit'
        )
      )
      .mockReturnValueOnce(chain({ data: legs, error: null }, 'in'));

    await expect(
      resolveContradictoryRefundFailure({ from } as never, row, order)
    ).resolves.toBe(false);
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          contradictory_refund_failure: true,
          failed_payment_transaction_ids: ['payment-1'],
          failed_refund_ids: ['refund-1'],
        }),
      })
    );
  });

  it('files when a replacement covers only one of two failed legs', async () => {
    const failedRows = [
      {
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
      },
      {
        amount: 50,
        created_at: '2026-09-27T12:30:00Z',
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: 'RFD-3',
        id: 'refund-3',
        metadata: {
          payment_transaction_id: 'payment-3',
          provider_refund_status: 'failed',
        },
      },
    ];
    const legs = [
      {
        amount: 100,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: 'PSK-1',
        id: 'payment-1',
      },
      {
        amount: 50,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: 'PSK-3',
        id: 'payment-3',
      },
    ];
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: failedRows, error: null }, 'limit'))
      .mockReturnValueOnce(
        chain(
          {
            data: [
              {
                amount: 100,
                created_at: '2026-09-27T13:00:00Z',
                currency: 'NGN',
                gateway: 'paystack',
                id: 'refund-2',
                metadata: {
                  payment_transaction_id: 'payment-1',
                  provider_refund_status: 'processed',
                },
              },
            ],
            error: null,
          },
          'limit'
        )
      )
      .mockReturnValueOnce(chain({ data: legs, error: null }, 'in'));

    await expect(
      resolveContradictoryRefundFailure({ from } as never, row, order)
    ).resolves.toBe(false);
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          contradictory_refund_failure: true,
          failed_payment_transaction_ids: ['payment-1', 'payment-3'],
          failed_refund_ids: ['refund-1', 'refund-3'],
        }),
      })
    );
  });

  it('files a falsely-refunded review when the failure is the latest evidence', async () => {
    const failedRows = [
      {
        amount: 100,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: 'RFD-1',
        id: 'refund-1',
        metadata: {
          payment_transaction_id: 'payment-1',
          provider_refund_status: 'failed',
        },
      },
    ];
    const legs = [
      {
        amount: 100,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: 'PSK-1',
        id: 'payment-1',
      },
    ];
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: failedRows, error: null }, 'limit'))
      .mockReturnValueOnce(chain({ data: [], error: null }, 'limit'))
      .mockReturnValueOnce(chain({ data: legs, error: null }, 'in'));

    await expect(
      resolveContradictoryRefundFailure({ from } as never, row, order)
    ).resolves.toBe(false);
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          contradictory_refund_failure: true,
          failed_payment_transaction_ids: ['payment-1'],
          failed_refund_ids: ['refund-1'],
        }),
        reason: expect.stringContaining('still marked refunded'),
        transactions: legs,
      })
    );
  });

  it('files even when no failed rows remain to attach', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: [], error: null }, 'limit'))
      .mockReturnValueOnce(chain({ data: [], error: null }, 'limit'));

    await expect(
      resolveContradictoryRefundFailure({ from } as never, row, order)
    ).resolves.toBe(false);
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({ transactions: [] })
    );
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('files when the only replacement is not provider-verified', async () => {
    const failedRows = [
      {
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
      },
    ];
    const legs = [
      {
        amount: 100,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: 'PSK-1',
        id: 'payment-1',
      },
    ];
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: failedRows, error: null }, 'limit'))
      .mockReturnValueOnce(
        chain(
          {
            data: [
              {
                amount: 100,
                created_at: '2026-09-27T13:00:00Z',
                currency: 'NGN',
                gateway: 'paystack',
                id: 'refund-2',
                // Locally completed but never provider-verified:
                // Paystack may yet reject it, so it cannot suppress
                // the failure alert.
                metadata: { payment_transaction_id: 'payment-1' },
              },
            ],
            error: null,
          },
          'limit'
        )
      )
      .mockReturnValueOnce(chain({ data: legs, error: null }, 'in'));

    await expect(
      resolveContradictoryRefundFailure({ from } as never, row, order)
    ).resolves.toBe(false);
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          contradictory_refund_failure: true,
        }),
      })
    );
  });

  it('scans past the first page before declaring every leg covered', async () => {
    const page1 = Array.from({ length: 50 }, (_, index) => ({
      amount: 10,
      created_at: '2026-09-27T10:00:00Z',
      currency: 'NGN',
      gateway: 'paystack',
      gateway_reference: `RFD-P1-${index}`,
      id: `refund-p1-${String(index).padStart(2, '0')}`,
      metadata: {
        payment_transaction_id: 'payment-9',
        provider_refund_status: 'processed',
      },
    }));
    const uncovered = {
      amount: 100,
      created_at: '2026-09-27T12:00:00Z',
      currency: 'NGN',
      gateway: 'paystack',
      gateway_reference: 'RFD-99',
      id: 'refund-99',
      metadata: {
        payment_transaction_id: 'payment-1',
        provider_refund_status: 'failed',
      },
    };
    const legs = [
      {
        amount: 100,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: 'PSK-1',
        id: 'payment-1',
      },
    ];
    const refundsPage2 = chain({ data: [uncovered], error: null }, 'limit');
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: page1, error: null }, 'limit'))
      .mockReturnValueOnce(refundsPage2)
      .mockReturnValueOnce(chain({ data: [], error: null }, 'limit'))
      .mockReturnValueOnce(chain({ data: legs, error: null }, 'in'));

    await expect(
      resolveContradictoryRefundFailure({ from } as never, row, order)
    ).resolves.toBe(false);
    // A newest-N cap would omit the older uncovered failure while the
    // included rows all look settled; the keyset scan reaches it.
    expect(refundsPage2.gt).toHaveBeenCalledWith('id', 'refund-p1-49');
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          failed_refund_ids: ['refund-99'],
        }),
      })
    );
  });

  it('retries when the replacement lookup fails', async () => {
    const from = vi
      .fn()
      .mockReturnValue(
        chain({ data: null, error: new Error('db down') }, 'limit')
      );

    await expect(
      resolveContradictoryRefundFailure({ from } as never, row, order)
    ).rejects.toThrow('refund_notification_replacement_lookup_failed');
    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
  });

  it('retries when the contradiction review cannot be filed', async () => {
    mocks.quarantineRefund.mockRejectedValue(new Error('review write failed'));
    const from = vi
      .fn()
      .mockReturnValueOnce(chain({ data: [], error: null }, 'limit'))
      .mockReturnValueOnce(chain({ data: [], error: null }, 'limit'));

    await expect(
      resolveContradictoryRefundFailure({ from } as never, row, order)
    ).rejects.toThrow('review write failed');
  });
});
