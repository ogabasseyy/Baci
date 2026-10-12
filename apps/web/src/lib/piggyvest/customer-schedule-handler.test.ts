import { expect, it, vi } from 'vitest';
import { customerScheduleHandlerFixture as fixture } from './customer-schedule-handler.test-support';

vi.mock('server-only', () => ({}));

it('authenticates before CSRF, parsing or protected reads', async () => {
  const test = fixture();
  test.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await test.handler.POST(test.request('POST', null))).status).toBe(
    401
  );
  expect(test.checkCsrfProtection).not.toHaveBeenCalled();
  expect(test.from).not.toHaveBeenCalled();
  expect(test.execute).not.toHaveBeenCalled();
});

it('projects current state without internal scope, actor or source token', async () => {
  const test = fixture();
  const response = await test.handler.GET(test.request());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  expect(body).toMatchObject({
    status: 'available',
    goalId: test.goalId,
    state: { version: 0, status: 'paused', consentProposal: null },
    historical: null,
    debitPermission: false,
    dispatch: 'disabled',
  });
  expect(JSON.stringify(body)).not.toMatch(
    /actorId|merchantId|customerId|token|trusted|synthetic-business/
  );
});

it('uses actual store planner and server source for strict POST', async () => {
  const test = fixture();
  const response = await test.handler.POST(test.request('POST'));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    status: 'persisted_proposal',
    goalId: test.goalId,
    receipt: {
      operationId: test.body.operationId,
      debitPermission: false,
      state: { version: 1, status: 'paused' },
    },
  });
  expect(test.execute).toHaveBeenCalledTimes(2);
  expect(JSON.parse(test.execute.mock.calls[1][1][6]).token).toBe(
    test.snapshot.token
  );
});

it.each([
  'actorId',
  'actor',
  'source',
  'token',
  'proposal',
])('rejects client %s authority before SQL', async (key) => {
  const test = fixture();
  expect(
    (
      await test.handler.POST(
        test.request('POST', { ...test.body, [key]: 'injected' })
      )
    ).status
  ).toBe(400);
  expect(test.execute).not.toHaveBeenCalled();
});

it('rejects CSRF and mismatched fixed goal', async () => {
  const test = fixture();
  test.checkCsrfProtection.mockResolvedValueOnce({ valid: false });
  expect((await test.handler.POST(test.request('POST'))).status).toBe(403);
  expect(
    (
      await test.handler.GET(
        test.request('GET', null, `?goalId=${test.actorId}`)
      )
    ).status
  ).toBe(403);
  expect(test.execute).not.toHaveBeenCalled();
});

it('correlates lost-write uncertainty and redacts dependency errors', async () => {
  const test = fixture();
  test.execute
    .mockImplementationOnce(async () => ({ rows: [{ result: test.snapshot }] }))
    .mockRejectedValueOnce(new Error('private password SQL marker'));
  const response = await test.handler.POST(test.request('POST'));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    status: 'unconfirmed',
    goalId: test.goalId,
    operationId: test.body.operationId,
    readbackRequired: true,
    dispatch: 'disabled',
    debitPermission: false,
  });
});
