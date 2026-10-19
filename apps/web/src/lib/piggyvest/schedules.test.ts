import { describe, expect, it, vi } from 'vitest';
import { createSchedulePayment, updateSchedulePayment } from './schedules';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

const walletInput = {
  amountKobo: 500000,
  startDate: '2026-10-20 20:00:00',
  payoutType: 'recurring',
  frequency: 'month',
  sourceWalletId: 'bcc018ee-0c3d-4ad1-8906-583bb21274e2',
  destinationType: 'wallet',
  description: 'Synthetic monthly contribution',
  destinationId: '70087c27-08a6-4638-9d1f-f8075e75cb60',
} as const;

describe('createSchedulePayment', () => {
  it('returns the schedule id for a wallet destination', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Transaction fetched successfully',
        data: { schedule_payment_id: '4b9353ea-cf7a-4900-b6f6-53e7aec89d40' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createSchedulePayment(
      { token: 'synthetic-token' },
      { ...walletInput }
    );

    expect(result).toEqual({
      schedule_payment_id: '4b9353ea-cf7a-4900-b6f6-53e7aec89d40',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/transfer/schedule-payment');
    expect(JSON.parse(init.body as string)).toMatchObject({
      amount: 500000,
      payout_type: 'recurring',
      frequency: 'month',
      destination_type: 'wallet',
    });
    vi.unstubAllGlobals();
  });

  it('requires a bank code and NUBAN destination for bank payouts', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(() =>
      createSchedulePayment(
        { token: 'synthetic-token' },
        {
          ...walletInput,
          destinationType: 'bank',
          destinationId: '70087c27-08a6-4638-9d1f-f8075e75cb60',
        }
      )
    ).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('rejects provider-date shapes outside YYYY-MM-DD HH:mm:ss', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(() =>
      createSchedulePayment(
        { token: 'synthetic-token' },
        { ...walletInput, startDate: '2026-10-20T20:00:00Z' }
      )
    ).toThrow('YYYY-MM-DD HH:mm:ss');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('updateSchedulePayment', () => {
  it('cancels with PATCH is_active false and reports updated', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ status: true, message: 'Schedule payment updated' })
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await updateSchedulePayment(
      { token: 'synthetic-token' },
      {
        schedulePaymentId: '4b9353ea-cf7a-4900-b6f6-53e7aec89d40',
        isActive: false,
      }
    );

    expect(result).toEqual({ updated: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      '/api/v1/transfer/schedule-payment/4b9353ea-cf7a-4900-b6f6-53e7aec89d40'
    );
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toMatchObject({
      is_active: false,
    });
    vi.unstubAllGlobals();
  });
});
