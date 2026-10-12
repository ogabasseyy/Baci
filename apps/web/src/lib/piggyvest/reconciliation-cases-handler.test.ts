import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { createReconciliationCasesHandler } from './reconciliation-cases-handler';

vi.mock('server-only', () => ({}));
const identity = vi.hoisted(() => 'abcdef00-0000-4000-8000-000000000001');
vi.mock('./customer-policy-context', () => ({
  resolvePiggyvestCustomerPolicyContext: async () => ({
    status: 'ready',
    actorId: identity,
    configuration: {
      environment: 'staging',
      integrationId: identity,
      merchantId: identity,
      customerId: identity,
      goalId: identity,
      expectedBusinessId: 'synthetic',
    },
  }),
}));
function fixture(authenticated = true) {
  const execute = vi.fn().mockResolvedValue({
    rows: [
      {
        result: {
          status: 'absent',
          caseId: identity,
          goalId: identity,
          financialEffects: 'UNKNOWN',
          fundsUse: 'not_authorized',
          dispatch: 'disabled',
        },
      },
    ],
  });
  const csrf = vi.fn().mockResolvedValue({ valid: true });
  const getUser = vi.fn().mockResolvedValue({
    data: { user: authenticated ? { id: identity } : null },
    error: null,
  });
  const options = {
    supabase: { auth: { getUser } } as unknown as SupabaseClient,
    goalId: identity,
    configuration: {},
    execute,
    checkCsrfProtection: csrf,
  };
  return {
    options,
    execute,
    csrf,
    handler: createReconciliationCasesHandler(options),
  };
}
const request = () =>
  new NextRequest(
    'http://localhost/reconciliation?goalId=' +
      identity +
      '&collectionOperationId=' +
      identity
  );
it('authenticates before case read and SQL', async () => {
  const test = fixture(false);
  expect((await test.handler.GET(request())).status).toBe(401);
  expect(test.execute).not.toHaveBeenCalled();
});
it('returns missing metadata with no retry or spending authority', async () => {
  const test = fixture();
  expect(await (await test.handler.GET(request())).json()).toMatchObject({
    status: 'absent',
    fundsUse: 'not_authorized',
    financialEffects: 'UNKNOWN',
  });
  expect(test.csrf).not.toHaveBeenCalled();
});
it('rejects mutations and redacts invalid SQL responses', async () => {
  const test = fixture();
  expect(
    (await test.handler.GET(new NextRequest(request().url, { method: 'POST' })))
      .status
  ).toBe(405);
  expect(test.execute).not.toHaveBeenCalled();
  test.execute.mockResolvedValue({ rows: [{ result: { secret: 'private' } }] });
  const response = await test.handler.GET(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private');
});
