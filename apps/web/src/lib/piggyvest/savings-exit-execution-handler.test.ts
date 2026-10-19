import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { createSavingsExitExecutionHandler } from './savings-exit-execution-handler';

vi.mock('server-only', () => ({}));

const identity = '30000000-0000-4000-8000-000000000001';
const operationId = '80000000-0000-4000-8000-000000000001';
const policy = {
  policyId: '70000000-0000-4000-8000-000000000001',
};

function fixture(authenticated = true) {
  const getUser = vi.fn().mockResolvedValue({
    data: { user: authenticated ? { id: identity } : null },
    error: null,
  });
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({
        data:
          table === 'merchants'
            ? { id: identity }
            : table === 'customers'
              ? { id: identity, merchant_id: identity, user_id: identity }
              : { id: identity, merchant_id: identity, customer_id: identity },
        error: null,
      })),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    return query;
  });
  const execute = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [
        {
          result: {
            state: 'verify',
            operationId,
            transfer: {
              action: 'cancellation',
              operationId,
              reference: operationId,
              sourceWalletId: 'savings-wallet',
              destinationWalletId: 'customer-wallet',
              amountKobo: 100,
              currency: 'NGN',
            },
          },
        },
      ],
    })
    .mockResolvedValueOnce({
      rows: [{ result: { state: 'pending', operationId } }],
    });
  const checkCsrfProtection = vi.fn().mockResolvedValue({ valid: true });
  const handler = createSavingsExitExecutionHandler({
    supabase: { auth: { getUser }, from } as unknown as SupabaseClient,
    goalId: identity,
    configuration: {
      environment: 'staging',
      transport: 'local_test',
      integrationId: identity,
      merchantId: identity,
      expectedBusinessId: 'synthetic-business',
      allowlistedMerchantIds: [identity],
      allowlistedCustomerIds: [identity],
      expectedProjectId: 'synthetic',
      actualProjectId: 'synthetic',
    },
    execute,
    checkCsrfProtection,
    action: 'cancellation',
    policy,
    transferProvider: {
      submit: async () => ({ status: 'pending' }),
      verify: async (transfer) => ({ ...transfer, status: 'unknown' }),
    },
  });
  return { handler, getUser, from, execute, checkCsrfProtection };
}

function request(body: unknown) {
  return new NextRequest('http://127.0.0.1/purchase/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

it('authenticates before CSRF, request parsing, and scope queries', async () => {
  const test = fixture(false);

  expect(
    (await test.handler.POST(request({ goalId: identity, operationId }))).status
  ).toBe(401);
  expect(test.checkCsrfProtection).not.toHaveBeenCalled();
  expect(test.from).not.toHaveBeenCalled();
  expect(test.execute).not.toHaveBeenCalled();
});

it('rejects body-selected policy and provider finality before any scope query', async () => {
  const test = fixture();

  expect(
    (
      await test.handler.POST(
        request({
          goalId: identity,
          operationId,
          policy,
          providerFinality: 'success',
        })
      )
    ).status
  ).toBe(400);
  expect(test.from).not.toHaveBeenCalled();
  expect(test.execute).not.toHaveBeenCalled();
});

it('passes only the server-configured policy through the scoped executor', async () => {
  const test = fixture();

  const response = await test.handler.POST(
    request({ goalId: identity, operationId })
  );

  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body).toEqual({
    status: 'pending_verification',
    operationId,
  });
  expect(test.execute).toHaveBeenCalledTimes(3);
  expect(test.execute.mock.calls[0][1][7]).toBe('cancellation');
  expect(JSON.parse(test.execute.mock.calls[0][1][8])).toEqual(policy);
});
