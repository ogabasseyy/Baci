import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import { createPiggyvestCustomerCancelHandler } from './customer-cancel-handler';

vi.mock('server-only', () => ({}));
const goalId = '3a000000-0000-4000-8000-000000000001';
const merchantId = '10000000-0000-4000-8000-000000000001';
const customerId = '20000000-0000-4000-8000-000000000001';
const actorId = '90000000-0000-4000-8000-000000000001';
const confirmation = {
  goalId,
  operationId: '80000000-0000-4000-8000-000000000001',
  revisionId: '70000000-0000-4000-8000-000000000001',
  termsVersion: 'synthetic-v1',
  termsHash: 'a'.repeat(64),
  consentVersion: '2026-09-11',
  accepted: true,
  principalKobo: 100,
  paidInterestKobo: 7,
  pendingInterestKobo: 3,
};
const receipt = {
  status: 'prepared',
  operationId: confirmation.operationId,
  collectionPaused: true,
  dispatch: 'contract_gap',
  interestDisposition: 'unresolved',
};
function fixture() {
  const getUser = vi
    .fn()
    .mockResolvedValue({ data: { user: { id: actorId } }, error: null });
  const rows: Record<string, unknown> = {
    merchants: { id: merchantId },
    customers: { id: customerId, merchant_id: merchantId, user_id: actorId },
    customer_savings_goals: {
      id: goalId,
      merchant_id: merchantId,
      customer_id: customerId,
    },
  };
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: rows[table], error: null })),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    return query;
  });
  const execute = vi.fn(
    async (
      _statement: string,
      _parameters: readonly string[]
    ): Promise<{ rows: unknown }> => ({ rows: [{ result: receipt }] })
  );
  const checkCsrfProtection = vi.fn().mockReturnValue({ valid: true });
  const configuration = {
    environment: 'staging',
    transport: 'local_test',
    integrationId: '40000000-0000-4000-8000-000000000001',
    merchantId,
    expectedBusinessId: 'synthetic-business',
    allowlistedMerchantIds: [merchantId],
    allowlistedCustomerIds: [customerId],
    expectedProjectId: 'synthetic',
    actualProjectId: 'synthetic',
  };
  const handler = createPiggyvestCustomerCancelHandler({
    supabase: { auth: { getUser }, from } as unknown as SupabaseClient,
    goalId,
    configuration,
    execute,
    checkCsrfProtection,
  });
  return {
    handler,
    getUser,
    from,
    rows,
    execute,
    checkCsrfProtection,
    configuration,
  };
}
function post(body: unknown = confirmation) {
  return new NextRequest('https://synthetic.test/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
afterEach(() => vi.useRealTimers());
it('compares a valid uppercase request goal canonically with the fixed goal', async () => {
  const test = fixture();
  const response = await test.handler.POST(
    post({ ...confirmation, goalId: goalId.toUpperCase() })
  );
  expect(response.status).toBe(200);
  expect(test.execute.mock.calls[0][1][3]).toBe(goalId);
});
it('denies identity drift during execution revalidation', async () => {
  const test = fixture();
  test.getUser.mockResolvedValueOnce({
    data: { user: { id: actorId } },
    error: null,
  });
  test.getUser.mockResolvedValueOnce({
    data: { user: { id: actorId } },
    error: null,
  });
  test.getUser.mockResolvedValue({
    data: { user: { id: customerId } },
    error: null,
  });
  expect((await test.handler.POST(post())).status).toBe(503);
  expect(test.execute).not.toHaveBeenCalled();
});
it('authenticates before CSRF, body and database and denies absent auth', async () => {
  const test = fixture();
  test.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await test.handler.POST(post())).status).toBe(401);
  expect(test.from).not.toHaveBeenCalled();
  expect(test.execute).not.toHaveBeenCalled();
  expect(test.checkCsrfProtection).not.toHaveBeenCalled();
});
it('prepares only with the authenticated actor in the sixth JSON parameter', async () => {
  const test = fixture();
  const response = await test.handler.POST(post());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ ...receipt, goalId });
  expect(test.execute).toHaveBeenCalledOnce();
  const [statement, parameters] = test.execute.mock.calls[0];
  expect(statement).toContain('piggyvest_cancel_plan.prepare(');
  expect(parameters).toHaveLength(6);
  const { goalId: _goalId, ...command } = confirmation;
  expect(JSON.parse(parameters[5])).toEqual({ ...command, actorId });
  expect(test.getUser.mock.invocationCallOrder[0]).toBeLessThan(
    test.checkCsrfProtection.mock.invocationCallOrder[0]
  );
});
it.each([
  { actorId },
  { customerId },
  { goalId: customerId },
  { principalKobo: 1.1 },
])('rejects spoofed or malformed input %j before execution', async (change) => {
  const test = fixture();
  expect(
    (await test.handler.POST(post({ ...confirmation, ...change }))).ok
  ).toBe(false);
  expect(test.execute).not.toHaveBeenCalled();
  expect(test.from).not.toHaveBeenCalled();
});
it('denies CSRF before reading any database', async () => {
  const test = fixture();
  test.checkCsrfProtection.mockReturnValue({ valid: false });
  expect((await test.handler.POST(post())).status).toBe(403);
  expect(test.from).not.toHaveBeenCalled();
});
it.each([
  'customers',
  'customer_savings_goals',
])('denies cross tenant %s', async (table) => {
  const test = fixture();
  test.rows[table] = {
    id: customerId,
    merchant_id: actorId,
    user_id: actorId,
    customer_id: customerId,
  };
  expect((await test.handler.POST(post())).status).toBe(403);
  expect(test.execute).not.toHaveBeenCalled();
});
it('fails closed outside local_test', async () => {
  const test = fixture();
  test.configuration.transport = 'tls';
  expect((await test.handler.POST(post())).status).toBe(403);
  expect(test.from).not.toHaveBeenCalled();
});
it('keeps uncertain reservations and permits exact replay without another quote', async () => {
  const test = fixture();
  test.execute.mockRejectedValueOnce(
    new Error('private stale quote or lost response')
  );
  const first = await test.handler.POST(post());
  expect(first.status).toBe(503);
  expect(await first.json()).toEqual({
    status: 'unavailable',
    goalId,
    operationId: confirmation.operationId,
    reservation: 'may_be_retained',
    dispatch: 'contract_gap',
  });
  expect((await test.handler.POST(post())).status).toBe(200);
  expect(test.execute.mock.calls[0]).toEqual(test.execute.mock.calls[1]);
  expect(test.execute).toHaveBeenCalledTimes(2);
});
it('times out a pending prepare without retry or reservation release', async () => {
  vi.useFakeTimers();
  const test = fixture();
  test.execute.mockImplementationOnce(() => new Promise(() => {}));
  const response = test.handler.POST(post());
  await vi.advanceTimersByTimeAsync(5001);
  expect((await response).status).toBe(503);
  expect(test.execute).toHaveBeenCalledOnce();
});
it('suppresses a successful receipt if ownership changes after execution', async () => {
  const test = fixture();
  test.execute.mockImplementationOnce(async () => {
    test.rows.customers = null;
    return { rows: [{ result: receipt }] };
  });
  const response = await test.handler.POST(post());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    reservation: 'may_be_retained',
  });
});
it('returns a safe policy-specific GET without preparing', async () => {
  const test = fixture();
  test.execute.mockResolvedValue({
    rows: [{ result: { status: 'requires_policy_specific_handling' } }],
  });
  const response = await test.handler.GET(
    new NextRequest(`https://synthetic.test/cancel?goalId=${goalId}`)
  );
  expect(await response.json()).toEqual({
    status: 'requires_policy_specific_handling',
    goalId,
  });
  expect(test.execute.mock.calls[0][1][5]).toBe(actorId);
  expect(test.execute.mock.calls[0][0]).toContain(
    'piggyvest_cancel_plan.quote('
  );
});
it.each([
  '{',
  ' '.repeat(4097),
])('rejects malformed or oversized raw JSON', async (body) => {
  const test = fixture();
  const response = await test.handler.POST(
    new NextRequest('https://synthetic.test/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
  );
  expect(response.status).toBe(400);
  expect(test.from).not.toHaveBeenCalled();
});
