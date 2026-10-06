import { expect, it, vi } from 'vitest';
import { createPiggyvestCancellationClientBinding } from './piggyvest-cancellation-client-binding';

const goalId = '11111111-1111-4111-8111-111111111111';
const source = {
  environment: 'staging',
  status: 'ready',
  sessionKey: 'session',
  goalId,
  policy: {
    status: 'draft',
    goalId,
    revisionId: goalId,
    device: { productName: 'Synthetic', variant: null, condition: 'New' },
    terms: { version: 'synthetic', hash: 'a'.repeat(64), text: 'Synthetic' },
    consent: 'accepted',
  },
  eligibility: { status: 'blocked' },
  funding: { status: 'unavailable' },
  progress: { status: 'unavailable' },
};
it('keeps the exact attempted operation uncertain after HTTP deadline even if transport cannot cancel', async () => {
  vi.useFakeTimers();
  try {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      if (init?.method === 'POST')
        return new Promise<Response>(() => undefined);
      const response = Response.json({
        status: 'quote_available',
        goalId,
        revisionId: goalId,
        termsVersion: 'synthetic',
        termsHash: 'a'.repeat(64),
        consentVersion: '2026-09-11',
        principalKobo: 10000,
        paidInterestKobo: 0,
        pendingInterestKobo: 0,
        interestDisposition: 'unresolved',
        dispatch: 'contract_gap',
      });
      Object.defineProperty(response, 'url', { value: String(url) });
      return response;
    });
    const controller = await createPiggyvestCancellationClientBinding({
      mode: 'prepare',
      source,
      tenantKey: 'tenant',
      operationId: goalId,
      isCurrent: () => true,
      http: {
        configuration: {
          mode: 'local_test',
          baseUrl: 'http://127.0.0.1:3000',
          endpointPath: '/cancel',
          recoveryEndpointPath: '/recovery',
        },
        fetch,
        getCsrfToken: async () => 'synthetic',
      },
    });
    const review = controller.read(source);
    if (review?.status !== 'review') throw new Error('fixture');
    const pending = expect(controller.prepare(review.command)).rejects.toThrow(
      'Cancellation unavailable'
    );
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(controller.read(source)).toMatchObject({
      status: 'uncertain',
      recovery: null,
    });
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual(
      review.command
    );
    await expect(controller.prepare(review.command)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
it('requires caller operation before any quote side effect', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const getCsrfToken = vi.fn(async () => 'synthetic');
  await expect(
    createPiggyvestCancellationClientBinding({
      mode: 'prepare',
      source,
      tenantKey: 'tenant',
      isCurrent: () => true,
      http: {
        configuration: {
          mode: 'local_test',
          baseUrl: 'http://127.0.0.1:3000',
          endpointPath: '/cancel',
          recoveryEndpointPath: '/recovery',
        },
        fetch,
        getCsrfToken,
      },
    })
  ).rejects.toThrow('Cancellation unavailable');
  expect(fetch).not.toHaveBeenCalled();
  expect(getCsrfToken).not.toHaveBeenCalled();
});
it('creates recovery-only lifetime without HTTP or CSRF and scopes later query', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
    const response = Response.json({
      status: 'absent',
      goalId,
      requestedOperationId: null,
      operationId: null,
      reservation: 'unknown',
      retry: 'not_authorized',
      dispatch: 'contract_gap',
    });
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  const getCsrfToken = vi.fn(async () => 'synthetic');
  let current = true;
  const controller = await createPiggyvestCancellationClientBinding({
    mode: 'recovery',
    source,
    tenantKey: 'tenant',
    isCurrent: () => current,
    http: {
      configuration: {
        mode: 'local_test',
        baseUrl: 'http://127.0.0.1:3000',
        endpointPath: '/cancel',
        recoveryEndpointPath: '/recovery',
      },
      fetch,
      getCsrfToken,
    },
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(getCsrfToken).not.toHaveBeenCalled();
  await controller.recover();
  expect(controller.read(source)).toMatchObject({
    status: 'uncertain',
    recovery: { status: 'absent' },
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(getCsrfToken).not.toHaveBeenCalled();
  current = false;
  await expect(controller.recover()).rejects.toThrow(
    'Cancellation unavailable'
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
