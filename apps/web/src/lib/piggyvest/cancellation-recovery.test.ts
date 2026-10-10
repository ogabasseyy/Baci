import { expect, it, vi } from 'vitest';
import { createCancellationRecoveryHandler } from './cancellation-recovery';
import { cancellationRecoveryFixture } from './cancellation-recovery.test-support';

vi.mock('server-only', () => ({}));

it('reads the original retained reservation with getUser first and no mutations', async () => {
  const test = cancellationRecoveryFixture();
  const response = await createCancellationRecoveryHandler(test.options).GET(
    test.request()
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual(test.prepared);
  expect(test.getUser.mock.invocationCallOrder[0]).toBeLessThan(
    test.from.mock.invocationCallOrder[0]
  );
  expect(test.execute).toHaveBeenCalledTimes(1);
  expect(test.execute.mock.calls[0][0]).toContain('read_recovery(');
  expect(test.execute.mock.calls[0][1].slice(-2)).toEqual([
    test.actorId,
    test.operationId,
  ]);
});

it('distinguishes response loss from absent and neither permits retry', async () => {
  const test = cancellationRecoveryFixture();
  const handler = createCancellationRecoveryHandler(test.options);
  test.execute.mockRejectedValueOnce(new Error('synthetic-private'));
  const unknown = await handler.GET(test.request());
  expect(unknown.status).toBe(503);
  expect(await unknown.json()).toEqual({
    status: 'unavailable',
    goalId: test.goalId,
    requestedOperationId: test.operationId,
    operationId: null,
    reservation: 'may_be_retained',
    retry: 'not_authorized',
    dispatch: 'contract_gap',
  });
  test.execute.mockResolvedValueOnce({
    rows: [
      {
        result: {
          status: 'absent',
          goalId: test.goalId,
          requestedOperationId: test.operationId,
          operationId: null,
          reservation: 'unknown',
          retry: 'not_authorized',
          dispatch: 'contract_gap',
        },
      },
    ],
  });
  const absent = await handler.GET(test.request());
  expect(absent.status).toBe(200);
  expect(await absent.json()).toMatchObject({
    status: 'absent',
    retry: 'not_authorized',
    reservation: 'unknown',
  });
});

it('supports goal-only reload without inventing an operation', async () => {
  const test = cancellationRecoveryFixture();
  test.execute.mockResolvedValueOnce({
    rows: [{ result: { ...test.prepared, requestedOperationId: null } }],
  });
  const response = await createCancellationRecoveryHandler(test.options).GET(
    test.request(`goalId=${test.goalId}`)
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    operationId: test.operationId,
    requestedOperationId: null,
  });
  expect(test.execute.mock.calls[0][1][6]).toBeNull();
});

it.each([
  'goalId',
  'operationId',
  'requestedOperationId',
])('rejects wrong %s correlation and never exposes the result', async (field) => {
  const test = cancellationRecoveryFixture();
  test.execute.mockResolvedValueOnce({
    rows: [{ result: { ...test.prepared, [field]: test.actorId } }],
  });
  const response = await createCancellationRecoveryHandler(test.options).GET(
    test.request()
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    status: 'unavailable',
    operationId: null,
  });
});

it('rejects private extra fields instead of forwarding raw database output', async () => {
  const test = cancellationRecoveryFixture();
  test.execute.mockResolvedValueOnce({
    rows: [{ result: { ...test.prepared, actorId: test.actorId } }],
  });
  const response = await createCancellationRecoveryHandler(test.options).GET(
    test.request()
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain(test.actorId);
});

it.each([
  'merchants',
  'customers',
  'customer_savings_goals',
])('rejects cross-owner %s without SQL', async (table) => {
  const test = cancellationRecoveryFixture();
  test.rows[table] = null;
  expect(
    (await createCancellationRecoveryHandler(test.options).GET(test.request()))
      .status
  ).toBe(403);
  expect(test.execute).not.toHaveBeenCalled();
});

it('authenticates before malformed input and fails closed on logout after read', async () => {
  const test = cancellationRecoveryFixture();
  const handler = createCancellationRecoveryHandler(test.options);
  test.getUser.mockRejectedValueOnce(new Error('signed out'));
  expect((await handler.GET(test.request('extra=bad'))).status).toBe(401);
  expect(test.execute).not.toHaveBeenCalled();
  test.execute.mockImplementationOnce(async () => {
    test.getUser.mockRejectedValue(new Error('signed out'));
    return { rows: [{ result: test.prepared }] };
  });
  const response = await handler.GET(test.request());
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain('originalDisclosure');
});

it.each([
  'extra=true',
  'operationId=not-uuid',
  'goalId=duplicate',
])('rejects unexpected or duplicate query %s', async (extra) => {
  const test = cancellationRecoveryFixture();
  const query = `goalId=${test.goalId}&${extra}`;
  expect(
    (
      await createCancellationRecoveryHandler(test.options).GET(
        test.request(query)
      )
    ).status
  ).toBe(400);
  expect(test.execute).not.toHaveBeenCalled();
});

it('times out an unknown read without retrying or treating it as absent', async () => {
  vi.useFakeTimers();
  try {
    const test = cancellationRecoveryFixture();
    test.execute.mockImplementation(() => new Promise(() => undefined));
    const pending = createCancellationRecoveryHandler(test.options).GET(
      test.request()
    );
    await vi.advanceTimersByTimeAsync(6000);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      status: 'unavailable',
      reservation: 'may_be_retained',
      retry: 'not_authorized',
    });
    expect(test.execute).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('rejects a valid but unbound goal and non-GET methods before SQL', async () => {
  const test = cancellationRecoveryFixture();
  const handler = createCancellationRecoveryHandler(test.options);
  expect(
    (await handler.GET(test.request(`goalId=${test.actorId}`))).status
  ).toBe(403);
  const request = test.request();
  Object.defineProperty(request, 'method', { value: 'POST' });
  expect((await handler.GET(request)).status).toBe(405);
  expect(test.execute).not.toHaveBeenCalled();
});
