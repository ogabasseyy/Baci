import { afterEach, describe, expect, it, vi } from 'vitest';
import { reconcileSavingsNotificationReceipts } from './receipt-reconciliation';

const receiptRows = [
  {
    ticket_id: 'ticket-confirmed',
    notification_id: 'b6e3aaf8-c90e-48da-b7c5-0dc49594f0c2',
    push_token: 'ExponentPushToken[private-one]',
  },
  {
    ticket_id: 'ticket-error',
    notification_id: 'cf42e3cc-88b8-41a1-9c79-e06ee36a38d2',
    push_token: 'ExponentPushToken[private-two]',
  },
];

describe('reconcileSavingsNotificationReceipts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('records provider receipt outcomes without calling them device delivery', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            'ticket-confirmed': { status: 'ok' },
            'ticket-error': {
              status: 'error',
              message: 'Do not persist or log provider text',
              details: { error: 'DeviceNotRegistered' },
            },
          },
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const recordReceipt = vi.fn().mockResolvedValue(true);

    const result = await reconcileSavingsNotificationReceipts(
      {
        pendingReceipts: vi.fn().mockResolvedValue(receiptRows),
        recordReceipt,
        requeueReceipt: vi.fn().mockResolvedValue(true),
      },
      { limit: 20, accessToken: 'server-only' }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://exp.host/--/api/v2/push/getReceipts',
      expect.objectContaining({
        body: JSON.stringify({ ids: ['ticket-confirmed', 'ticket-error'] }),
        headers: expect.objectContaining({
          Authorization: 'Bearer server-only',
        }),
      })
    );
    expect(recordReceipt).toHaveBeenNthCalledWith(
      1,
      'ticket-confirmed',
      'provider_confirmed',
      null
    );
    expect(recordReceipt).toHaveBeenNthCalledWith(
      2,
      'ticket-error',
      'receipt_failed',
      'DeviceNotRegistered'
    );
    expect(result).toEqual({
      checked: 2,
      providerConfirmed: 1,
      receiptFailed: 1,
      pending: 0,
      recordFailed: 0,
    });
  });

  it('leaves omitted, malformed, and transport-failed receipts pending', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { 'ticket-confirmed': { status: 'later' } } }),
          {
            status: 200,
          }
        )
      )
      .mockRejectedValueOnce(new Error('private token network timeout'));
    vi.stubGlobal('fetch', fetchMock);
    const pendingReceipts = vi.fn().mockResolvedValue(receiptRows);
    const recordReceipt = vi.fn().mockResolvedValue(true);

    const dependencies = {
      pendingReceipts,
      recordReceipt,
      requeueReceipt: vi.fn().mockResolvedValue(true),
    };
    const partial = await reconcileSavingsNotificationReceipts(dependencies, {
      limit: 20,
    });
    const failed = await reconcileSavingsNotificationReceipts(dependencies, {
      limit: 20,
    });

    expect(partial.pending).toBe(2);
    expect(failed.pending).toBe(2);
    expect(recordReceipt).not.toHaveBeenCalled();
  });

  it('leaves every receipt pending when Expo returns an HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ errors: [{ code: 'TEMP', message: 'opaque' }] }),
          {
            status: 503,
          }
        )
      )
    );
    const recordReceipt = vi.fn();

    const result = await reconcileSavingsNotificationReceipts(
      {
        pendingReceipts: vi.fn().mockResolvedValue(receiptRows),
        recordReceipt,
        requeueReceipt: vi.fn().mockResolvedValue(true),
      },
      { limit: 20 }
    );

    expect(result.pending).toBe(2);
    expect(recordReceipt).not.toHaveBeenCalled();
  });

  it('requeues a rate-limited receipt for a new send instead of finalizing it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              'ticket-confirmed': { status: 'ok' },
              'ticket-error': {
                status: 'error',
                message: 'Slow down',
                details: { error: 'MessageRateExceeded' },
              },
            },
          }),
          { status: 200 }
        )
      )
    );
    const recordReceipt = vi.fn().mockResolvedValue(true);
    const requeueReceipt = vi.fn().mockResolvedValue(true);

    const result = await reconcileSavingsNotificationReceipts(
      {
        pendingReceipts: vi.fn().mockResolvedValue(receiptRows),
        recordReceipt,
        requeueReceipt,
      },
      { limit: 20 }
    );

    expect(recordReceipt).toHaveBeenCalledTimes(1);
    expect(recordReceipt).toHaveBeenCalledWith(
      'ticket-confirmed',
      'provider_confirmed',
      null
    );
    expect(requeueReceipt).toHaveBeenCalledTimes(1);
    expect(requeueReceipt).toHaveBeenCalledWith('ticket-error');
    expect(result).toEqual({
      checked: 2,
      providerConfirmed: 1,
      receiptFailed: 0,
      pending: 1,
      recordFailed: 0,
    });
  });

  it('keeps polling a rate-limited receipt when its requeue fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              'ticket-error': {
                status: 'error',
                message: 'Slow down',
                details: { error: 'MessageRateExceeded' },
              },
            },
          }),
          { status: 200 }
        )
      )
    );
    const requeueReceipt = vi.fn().mockResolvedValue(false);

    const result = await reconcileSavingsNotificationReceipts(
      {
        pendingReceipts: vi.fn().mockResolvedValue([receiptRows[1]]),
        recordReceipt: vi.fn().mockResolvedValue(true),
        requeueReceipt,
      },
      { limit: 20 }
    );

    expect(result).toEqual({
      checked: 1,
      providerConfirmed: 0,
      receiptFailed: 0,
      pending: 1,
      recordFailed: 1,
    });
  });

  it('rejects a receipt batch larger than the bounded worker limit before querying rows', async () => {
    const pendingReceipts = vi.fn();

    await expect(
      reconcileSavingsNotificationReceipts(
        {
          pendingReceipts,
          recordReceipt: vi.fn(),
          requeueReceipt: vi.fn(),
        },
        { limit: 101 }
      )
    ).rejects.toThrow();
    expect(pendingReceipts).not.toHaveBeenCalled();
  });
});
