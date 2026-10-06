import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { piggyvestCustomerLifecycleHandlerSchemas } from '@/schemas/piggyvest-customer-lifecycle-handler';
import { createPiggyvestCustomerOperationHandler } from './customer-operation-handler';
import { PIGGYVEST_POSTGRES_EXECUTOR } from './postgres-executor.constants';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

vi.mock('server-only', () => ({}));
const identifier = '30000000-0000-4000-8000-00000000000a';
function fixture() {
  let actor = identifier;
  const from = vi.fn((table: string) => {
    const reader = {
      select: () => reader,
      eq: () => reader,
      maybeSingle: async () => ({
        error: null,
        data:
          table === 'merchants'
            ? { id: identifier }
            : table === 'customers'
              ? { id: identifier, merchant_id: identifier, user_id: identifier }
              : {
                  id: identifier,
                  merchant_id: identifier,
                  customer_id: identifier,
                },
      }),
    };
    return reader;
  });
  const execute = vi.fn().mockResolvedValue({ rows: [] });
  const handle = createPiggyvestCustomerOperationHandler({
    supabase: {
      auth: {
        getUser: async () => ({ error: null, data: { user: { id: actor } } }),
      },
      from,
    } as unknown as SupabaseClient,
    goalId: identifier.toUpperCase(),
    configuration: {
      environment: 'staging',
      transport: 'local_test',
      integrationId: identifier,
      merchantId: identifier,
      expectedBusinessId: 'synthetic',
      allowlistedMerchantIds: [identifier],
      allowlistedCustomerIds: [identifier],
      expectedProjectId: 'synthetic',
      actualProjectId: 'synthetic',
    },
    execute,
    checkCsrfProtection: async () => ({ valid: true }),
  });
  const parameters = [
    identifier,
    identifier,
    identifier,
    identifier,
    'synthetic',
  ];
  const operation = {
    method: 'POST' as const,
    schema: piggyvestCustomerLifecycleHandlerSchemas.terms,
    uncertain: () => ({ status: 'unavailable', outcome: 'indeterminate' }),
    run: async (
      _input: unknown,
      context: {
        execute: (allowed: () => boolean) => PiggyvestProvisioningExecutor;
      }
    ) => {
      await context.execute(() => true)('exact', parameters);
      return { status: 'prepared' };
    },
  };
  return {
    handle,
    from,
    execute,
    operation,
    parameters,
    changeActor: () => {
      actor = '30000000-0000-4000-8000-00000000000b';
    },
  };
}
function request(
  body = JSON.stringify({
    goalId: identifier,
    revisionId: identifier,
    durationMonths: 1,
  }),
  signal?: AbortSignal
) {
  return new NextRequest('http://localhost/lifecycle/terms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal,
  });
}
it('canonicalizes valid fixed UUID identity and preserves scope', async () => {
  const test = fixture();
  expect((await test.handle(request(), test.operation)).status).toBe(200);
  expect(test.execute).toHaveBeenCalledOnce();
});
it.each([
  '{',
  ' '.repeat(4097),
])('rejects malformed or oversized raw JSON before RLS', async (body) => {
  const test = fixture();
  expect((await test.handle(request(body), test.operation)).status).toBe(400);
  expect(test.from).not.toHaveBeenCalled();
});
it('rejects a different fixed goal before RLS', async () => {
  const test = fixture();
  expect(
    (
      await test.handle(
        request(
          JSON.stringify({
            goalId: '30000000-0000-4000-8000-00000000000b',
            revisionId: identifier,
            durationMonths: 1,
          })
        ),
        test.operation
      )
    ).status
  ).toBe(403);
  expect(test.from).not.toHaveBeenCalled();
});
it('rejects a changed actor before dispatch', async () => {
  const test = fixture();
  const response = await test.handle(request(), {
    ...test.operation,
    run: async (input, context) => {
      test.changeActor();
      await context.execute(() => true)('exact', test.parameters);
      return input;
    },
  });
  expect(response.status).toBe(503);
  expect(test.execute).not.toHaveBeenCalled();
});
it('rejects foreign scope and unapproved statements', async () => {
  const test = fixture();
  const response = await test.handle(request(), {
    ...test.operation,
    run: async (input, context) => {
      await context.execute(() => false)('unapproved', test.parameters);
      return input;
    },
  });
  expect(response.status).toBe(503);
  expect(test.execute).not.toHaveBeenCalled();
});
it('rejects an approved statement with foreign scope parameters', async () => {
  const test = fixture();
  const response = await test.handle(request(), {
    ...test.operation,
    run: async (input, context) => {
      await context.execute(() => true)('exact', [
        'foreign',
        ...test.parameters.slice(1),
      ]);
      return input;
    },
  });
  expect(response.status).toBe(503);
  expect(test.execute).not.toHaveBeenCalled();
});

it('returns indeterminate instead of success after actor changes during execution', async () => {
  const test = fixture();
  test.execute.mockImplementation(async () => {
    test.changeActor();
    return { rows: [] };
  });
  const response = await test.handle(request(), test.operation);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    status: 'unavailable',
    outcome: 'indeterminate',
  });
  expect(test.execute).toHaveBeenCalledOnce();
});
it('retains indeterminate outcome on timeout without retry', async () => {
  vi.useFakeTimers();
  try {
    const test = fixture();
    test.execute.mockImplementation(() => new Promise(() => undefined));
    const response = test.handle(request(), test.operation);
    await vi.advanceTimersByTimeAsync(
      PIGGYVEST_POSTGRES_EXECUTOR.deadlineMs + 1
    );
    expect(await (await response).json()).toEqual({
      status: 'unavailable',
      outcome: 'indeterminate',
    });
    expect(test.execute).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
it('does not dispatch an aborted request', async () => {
  const test = fixture();
  const abort = new AbortController();
  abort.abort();
  expect(
    (await test.handle(request(undefined, abort.signal), test.operation)).ok
  ).toBe(false);
  expect(test.execute).not.toHaveBeenCalled();
});
