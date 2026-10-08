import { mockFetchWithTimeout } from '@/lib/wallet-top-up.test-utils';
import {
  getSavingsFirstCardCapability,
  refreshSavingsFirstCardCheckout,
  startSavingsFirstCardCheckout,
} from './savings-first-card-checkout';

const goalId = '00000000-0000-4000-8000-000000000001';
const intentId = '00000000-0000-4000-8000-000000000002';
const request = {
  goalId,
  amountKobo: 12500,
  idempotencyKey: '00000000-0000-4000-8000-000000000003',
  consent: {
    version: 'prefunded-first-card-v1' as const,
    oneTimeCharge: true as const,
    saveCard: true as const,
  },
};
const state = {
  intentId,
  goalId,
  amountKobo: request.amountKobo,
  currency: 'NGN' as const,
  status: 'ready' as const,
  authorizationUrl: 'https://checkout.paystack.com/access123',
};

function response(data: Record<string, unknown>) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => data };
}

it('uses the exact capability query and first-card request contract', async () => {
  mockFetchWithTimeout
    .mockResolvedValueOnce(
      response({
        goalId,
        enabled: true,
        maximumAmountKobo: 50000,
        currency: 'NGN',
      })
    )
    .mockResolvedValueOnce(response({ token: 'test-csrf-token' }))
    .mockResolvedValueOnce(response(state));
  await getSavingsFirstCardCapability({ goalId });
  await startSavingsFirstCardCheckout({ request });
  expect(mockFetchWithTimeout.mock.calls[0]?.[0]).toBe(
    `https://usebaci.com/api/storefront/customer/savings/card-checkout?goalId=${goalId}`
  );
  expect(mockFetchWithTimeout.mock.calls[1]?.[0]).toBe(
    'https://usebaci.com/api/csrf'
  );
  expect(mockFetchWithTimeout.mock.calls[2]?.[0]).toBe(
    'https://usebaci.com/api/storefront/customer/savings/card-checkout'
  );
  expect(mockFetchWithTimeout.mock.calls[2]?.[1]).toEqual(
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(request),
      headers: expect.objectContaining({
        Authorization: 'Bearer token-123',
        'x-csrf-token': 'test-csrf-token',
      }),
    })
  );
});

it('refreshes by intent and rejects identity or amount mismatches', async () => {
  mockFetchWithTimeout
    .mockResolvedValueOnce(response({ token: 'test-csrf-token' }))
    .mockResolvedValueOnce(response(state));
  await refreshSavingsFirstCardCheckout({ selection: { intentId, goalId } });
  expect(mockFetchWithTimeout.mock.calls[1]?.[1]).toEqual(
    expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ intentId, goalId }),
    })
  );
  mockFetchWithTimeout
    .mockResolvedValueOnce(response({ token: 'test-csrf-token' }))
    .mockResolvedValueOnce(response({ ...state, goalId: intentId }));
  await expect(
    refreshSavingsFirstCardCheckout({
      selection: { intentId, goalId },
    })
  ).rejects.toThrow(/does not match this request/);
  mockFetchWithTimeout
    .mockResolvedValueOnce(response({ token: 'test-csrf-token' }))
    .mockResolvedValueOnce(response({ ...state, amountKobo: 12501 }));
  await expect(startSavingsFirstCardCheckout({ request })).rejects.toThrow(
    /does not match this request/
  );
});
