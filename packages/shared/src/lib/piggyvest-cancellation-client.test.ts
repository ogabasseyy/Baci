import { expect, it, vi } from 'vitest';
import { createPiggyvestCancellationClient } from './piggyvest-cancellation-client';

const goalId = '11111111-1111-4111-8111-111111111111';
const operationId = 'abcdefab-2222-4222-8222-222222222222';
const configuration = {
  mode: 'local_test',
  baseUrl: 'http://127.0.0.1:3000',
  endpointPath: '/local/cancel',
  recoveryEndpointPath: '/local/recovery',
};
const command = {
  goalId,
  operationId: operationId.toUpperCase(),
  revisionId: goalId,
  termsVersion: 'synthetic',
  termsHash: 'a'.repeat(64),
  consentVersion: '2026-09-11',
  principalKobo: 10000,
  paidInterestKobo: 100,
  pendingInterestKobo: 200,
  accepted: true,
};
function response(body: unknown, url: string, status = 200) {
  const result = Response.json(body, { status });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}
function fixture() {
  const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
    response(
      {
        status: 'prepared',
        goalId,
        operationId,
        collectionPaused: true,
        dispatch: 'contract_gap',
        interestDisposition: 'unresolved',
      },
      String(url)
    )
  );
  const getCsrfToken = vi.fn(async () => 'synthetic-csrf');
  return {
    fetch,
    getCsrfToken,
    client: createPiggyvestCancellationClient({
      configuration,
      goalId,
      fetch,
      getCsrfToken,
      isCurrent: () => true,
    }),
  };
}
it('blocks cancellation dispatch when a sibling starts during deferred CSRF', async () => {
  const test = fixture();
  let release: (token: string) => void = () => undefined;
  let compatible = true;
  test.client.setViewGuard(() => compatible);
  test.getCsrfToken.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const pending = test.client.prepare(command);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(test.getCsrfToken).toHaveBeenCalledOnce());
  compatible = false;
  release('synthetic-csrf');
  await rejected;
  expect(test.fetch).not.toHaveBeenCalled();
});
it.each([
  undefined,
  null,
  {},
  { goalId: undefined },
  { goalId: 42 },
  { goalId: 'not-a-uuid' },
])('rejects malformed selection %j before HTTP or CSRF', async (selection) => {
  const test = fixture();
  await expect(test.client.recover(selection)).rejects.toThrow(
    'Cancellation unavailable'
  );
  await expect(test.client.prepare(selection)).rejects.toThrow(
    'Cancellation unavailable'
  );
  expect(test.fetch).not.toHaveBeenCalled();
  expect(test.getCsrfToken).not.toHaveBeenCalled();
});
it('posts exact original confirmation with explicit CSRF and redirect denial', async () => {
  const test = fixture();
  await expect(test.client.prepare(command)).resolves.toMatchObject({
    operationId,
  });
  expect(JSON.parse(String(test.fetch.mock.calls[0][1]?.body))).toEqual(
    command
  );
  expect(test.fetch.mock.calls[0][1]).toMatchObject({
    method: 'POST',
    credentials: 'omit',
    redirect: 'error',
    headers: { 'x-csrf-token': 'synthetic-csrf' },
  });
});
it('recovers goal-only without CSRF, extra keys or fabricated operation IDs', async () => {
  const test = fixture();
  test.fetch.mockImplementationOnce(async (url) =>
    response(
      {
        status: 'absent',
        goalId,
        requestedOperationId: null,
        operationId: null,
        reservation: 'unknown',
        retry: 'not_authorized',
        dispatch: 'contract_gap',
      },
      String(url)
    )
  );
  await expect(test.client.recover({ goalId })).resolves.toMatchObject({
    retry: 'not_authorized',
  });
  expect(test.fetch.mock.calls[0][0]).toBe(
    `${configuration.baseUrl}/local/recovery?goalId=${goalId}`
  );
  expect(test.getCsrfToken).not.toHaveBeenCalled();
  await expect(
    test.client.recover({ goalId, actorId: goalId })
  ).rejects.toThrow('Cancellation unavailable');
  expect(test.fetch).toHaveBeenCalledTimes(1);
});
it('redacts non-2xx, mismatched identity and unsupported native body without retry', async () => {
  const test = fixture();
  test.fetch.mockResolvedValueOnce(
    response(
      { private: 'secret' },
      `${configuration.baseUrl}/local/cancel`,
      503
    )
  );
  await expect(test.client.prepare(command)).rejects.toThrow(
    /^Cancellation unavailable$/
  );
  test.fetch.mockResolvedValueOnce(
    response(
      {
        status: 'prepared',
        goalId: operationId,
        operationId,
        collectionPaused: true,
        dispatch: 'contract_gap',
        interestDisposition: 'unresolved',
      },
      `${configuration.baseUrl}/local/cancel`
    )
  );
  await expect(test.client.prepare(command)).rejects.toThrow(
    /^Cancellation unavailable$/
  );
  test.fetch.mockResolvedValueOnce(new Response(null));
  await expect(test.client.prepare(command)).rejects.toThrow(
    /^Cancellation unavailable$/
  );
  expect(test.fetch).toHaveBeenCalledTimes(3);
});
it('rejects redirect, oversized bodies and recovery operation mismatch', async () => {
  const test = fixture();
  const redirected = response({}, `${configuration.baseUrl}/local/cancel`);
  Object.defineProperty(redirected, 'redirected', { value: true });
  test.fetch.mockResolvedValueOnce(redirected);
  await expect(test.client.prepare(command)).rejects.toThrow(
    'Cancellation unavailable'
  );
  test.fetch.mockResolvedValueOnce(
    response(
      { payload: 'x'.repeat(262145) },
      `${configuration.baseUrl}/local/cancel`
    )
  );
  await expect(test.client.prepare(command)).rejects.toThrow(
    'Cancellation unavailable'
  );
  test.fetch.mockImplementationOnce(async (url) =>
    response(
      {
        status: 'absent',
        goalId,
        requestedOperationId: null,
        operationId: null,
        reservation: 'unknown',
        retry: 'not_authorized',
        dispatch: 'contract_gap',
      },
      String(url)
    )
  );
  await expect(test.client.recover({ goalId, operationId })).rejects.toThrow(
    'Cancellation unavailable'
  );
  expect(test.fetch).toHaveBeenCalledTimes(3);
});
it('rejects identity invalidation during an uncancellable response and invalid CSRF before dispatch', async () => {
  const test = fixture();
  test.getCsrfToken.mockResolvedValueOnce('invalid token');
  await expect(test.client.prepare(command)).rejects.toThrow(
    'Cancellation unavailable'
  );
  expect(test.fetch).not.toHaveBeenCalled();
  let current = true;
  const client = createPiggyvestCancellationClient({
    configuration,
    goalId,
    fetch: async (url) => {
      current = false;
      return response({}, String(url));
    },
    getCsrfToken: test.getCsrfToken,
    isCurrent: () => current,
  });
  await expect(client.quote()).rejects.toThrow('Cancellation unavailable');
});
it('rejects stale/aborted calls before sending and times out without retry', async () => {
  const test = fixture();
  const abort = new AbortController();
  abort.abort();
  await expect(test.client.prepare(command, abort.signal)).rejects.toThrow();
  expect(test.fetch).not.toHaveBeenCalled();
  vi.useFakeTimers();
  try {
    test.fetch.mockReturnValueOnce(new Promise(() => undefined));
    const pending = expect(test.client.prepare(command)).rejects.toThrow(
      'Cancellation unavailable'
    );
    await vi.advanceTimersByTimeAsync(5000);
    await pending;
    expect(test.fetch).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
