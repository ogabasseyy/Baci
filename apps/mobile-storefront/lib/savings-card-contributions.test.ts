import {
  mockFetchWithTimeout,
  mockGetSession,
} from '@/lib/wallet-top-up.test-utils';
import {
  getSavingsCardContributionOptions,
  getSavingsCardContributionStatus,
  submitSavingsCardContribution,
} from './savings-card-contributions';

const goalId = '00000000-0000-4000-8000-000000000001';
const methodId = '00000000-0000-4000-8000-000000000002';
const idempotencyKey = '00000000-0000-4000-8000-000000000003';

function response(data: Record<string, unknown>) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => data };
}

it('constructs a fresh bearer client for each operation so auth-user changes cannot reuse a cached token', async () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  mockGetSession
    .mockResolvedValueOnce({
      data: { session: { access_token: 'customer-a', expires_at: expiresAt } },
      error: null,
    })
    .mockResolvedValueOnce({
      data: { session: { access_token: 'customer-b', expires_at: expiresAt } },
      error: null,
    });
  mockFetchWithTimeout
    .mockResolvedValueOnce(
      response({
        goalId,
        enabled: false,
        newCardEnabled: false,
        currency: 'NGN',
        maximumAmountKobo: 50000,
        savedMethods: [],
      })
    )
    .mockResolvedValueOnce(
      response({
        operationId: idempotencyKey,
        goalId,
        amountKobo: 12500,
        currency: 'NGN',
        status: 'pending',
      })
    );
  await getSavingsCardContributionOptions({ goalId });
  await getSavingsCardContributionStatus({ goalId, idempotencyKey });
  expect(mockGetSession).toHaveBeenCalledTimes(2);
  expect(mockFetchWithTimeout.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({ headers: { Authorization: 'Bearer customer-a' } })
  );
  expect(mockFetchWithTimeout.mock.calls[1]?.[1]).toEqual(
    expect.objectContaining({ headers: { Authorization: 'Bearer customer-b' } })
  );
  expect(mockFetchWithTimeout.mock.calls[0]?.[0]).toBe(
    `https://usebaci.com/api/storefront/customer/savings/card-contributions?goalId=${goalId}`
  );
  expect(mockFetchWithTimeout.mock.calls[1]?.[0]).toBe(
    `https://usebaci.com/api/storefront/customer/savings/card-contributions?goalId=${goalId}&idempotencyKey=${idempotencyKey}`
  );
});

it('posts only the strict one-time contribution body and rejects mismatched response identity', async () => {
  const request = {
    goalId,
    savedMethodId: methodId,
    amountKobo: 12500,
    idempotencyKey,
    consent: {
      version: 'prefunded-card-v1' as const,
      oneTimeCharge: true as const,
    },
  };
  mockFetchWithTimeout.mockResolvedValueOnce(
    response({
      operationId: idempotencyKey,
      goalId,
      amountKobo: 12500,
      currency: 'NGN',
      status: 'pending',
    })
  );
  await submitSavingsCardContribution({ request });
  expect(mockFetchWithTimeout.mock.calls[0]?.[0]).toBe(
    'https://usebaci.com/api/storefront/customer/savings/card-contributions'
  );
  expect(mockFetchWithTimeout.mock.calls[0]?.[1]).toEqual(
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(request),
    })
  );

  mockFetchWithTimeout.mockResolvedValueOnce(
    response({
      operationId: idempotencyKey,
      goalId: '00000000-0000-4000-8000-000000000004',
      amountKobo: 12500,
      currency: 'NGN',
      status: 'pending',
    })
  );
  await expect(
    getSavingsCardContributionStatus({ goalId, idempotencyKey })
  ).rejects.toThrow(/does not match this plan/);
});

it('rejects a POST result whose canonical amount differs from the requested amount', async () => {
  mockFetchWithTimeout.mockResolvedValueOnce(
    response({
      operationId: idempotencyKey,
      goalId,
      amountKobo: 12501,
      currency: 'NGN',
      status: 'pending',
    })
  );
  await expect(
    submitSavingsCardContribution({
      request: {
        goalId,
        savedMethodId: methodId,
        amountKobo: 12500,
        idempotencyKey,
        consent: { version: 'prefunded-card-v1', oneTimeCharge: true },
      },
    })
  ).rejects.toThrow(/does not match this request/);
});
