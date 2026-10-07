// @vitest-environment node

import { createPiggyvestCancellationClientBinding } from '@baci/shared/lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { CANCELLATION_RECOVERY_STATEMENTS } from '@/lib/piggyvest/cancellation-recovery-statements';
import { customerCancelFlowFixture } from '@/lib/piggyvest/customer-cancel-flow.test-support';
import { startPiggyvestRuntimeCompositionServer } from '@/lib/piggyvest/runtime-composition-server';

vi.mock('server-only', () => ({}));

it('connects shared client/controller over real HTTP to composed auth/CSRF routes with synthetic RLS and executor', async () => {
  const test = customerCancelFlowFixture();
  const quote = await test.load();
  if (quote.status !== 'quote_available') throw new Error('fixture');
  const {
    status: _status,
    goalId: _goalId,
    dispatch: _dispatch,
    interestDisposition: _interest,
    ...originalDisclosure
  } = quote;
  const source = {
    environment: 'staging',
    status: 'ready',
    sessionKey: 'synthetic-session',
    goalId: test.goalId,
    policy: {
      status: 'draft',
      goalId: test.goalId,
      revisionId: quote.revisionId,
      device: {
        productName: 'Synthetic phone',
        variant: null,
        condition: 'New',
      },
      terms: {
        version: quote.termsVersion,
        hash: quote.termsHash,
        text: 'Synthetic terms',
      },
      consent: 'accepted',
    },
    eligibility: { status: 'blocked' },
    funding: { status: 'unavailable' },
    progress: { status: 'unavailable' },
  } as const;
  let signedIn = true;
  const server = await startPiggyvestRuntimeCompositionServer({
    port: 0,
    configuration: {
      mode: 'local_test',
      goalId: test.goalId,
      context: {
        environment: 'staging',
        transport: 'local_test',
        merchantId: '10000000-0000-4000-8000-000000000001',
        integrationId: '40000000-0000-4000-8000-000000000001',
        expectedBusinessId: 'synthetic-business',
        expectedProjectId: 'synthetic',
        actualProjectId: 'synthetic',
        allowlistedMerchantIds: ['10000000-0000-4000-8000-000000000001'],
        allowlistedCustomerIds: ['20000000-0000-4000-8000-000000000001'],
      },
      termsDocument: source.policy.terms,
    },
    createRlsClient: async (request) =>
      ({
        auth: {
          getUser: async () => ({
            data: {
              user:
                signedIn &&
                request.cookies.get('synthetic-session')?.value === 'local'
                  ? { id: test.actorId }
                  : null,
            },
            error: null,
          }),
        },
        from: test.from,
      }) as unknown as SupabaseClient,
    execute: async (statement, parameters) => {
      if (
        statement ===
        CANCELLATION_RECOVERY_STATEMENTS.readCancellationRecovery.text
      )
        return {
          rows: [
            {
              result: {
                status: 'prepared',
                goalId: test.goalId,
                requestedOperationId: parameters[6],
                operationId: test.operationId,
                reservation: 'retained',
                retry: 'not_authorized',
                dispatch: 'contract_gap',
                interestDisposition: 'unresolved',
                originalDisclosure,
              },
            },
          ],
        };
      return test.execute(statement, parameters);
    },
  });
  const nativeFetch = globalThis.fetch;
  const bootstrap = await nativeFetch(`${server.origin}/csrf`, {
    headers: { origin: server.origin, cookie: 'synthetic-session=local' },
  });
  expect(bootstrap.status).toBe(200);
  const { csrfToken } = await bootstrap.json();
  const csrfCookie = bootstrap.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  let loseResponse = true;
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const headers = new Headers(init?.headers);
    if (init?.credentials === 'include')
      headers.set('cookie', `synthetic-session=local; ${csrfCookie}`);
    headers.set('origin', server.origin);
    const result = await nativeFetch(url, { ...init, headers });
    if (init?.method === 'POST' && loseResponse) {
      loseResponse = false;
      expect(result.status).toBe(200);
      await result.body?.cancel();
      throw new Error(
        'synthetic response lost after actual HTTP server commit boundary'
      );
    }
    return result;
  });
  const getCsrfToken = vi.fn(async () => csrfToken);
  const http = {
    configuration: {
      mode: 'local_test',
      baseUrl: server.origin,
      endpointPath: '/cancel',
      recoveryEndpointPath: '/recovery',
      credentials: 'include',
    },
    fetch,
    getCsrfToken,
  };
  try {
    const binding = await createPiggyvestCancellationClientBinding({
      mode: 'prepare',
      source,
      tenantKey: 'synthetic-tenant',
      operationId: test.operationId,
      http,
      isCurrent: () => signedIn,
    });
    const review = binding.read(source);
    if (review?.status !== 'review') throw new Error('fixture');
    binding.setViewGuard(() => signedIn);
    await expect(binding.prepare(review.command)).rejects.toThrow(
      'Cancellation unavailable'
    );
    expect(test.preparedCommands()).toHaveLength(1);
    await expect(binding.prepare(review.command)).rejects.toThrow();
    const reloaded = await createPiggyvestCancellationClientBinding({
      mode: 'recovery',
      source,
      tenantKey: 'synthetic-tenant',
      http,
      isCurrent: () => signedIn,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    await reloaded.recover();
    const recoveredView = reloaded.read(source);
    if (!recoveredView || recoveredView.status === 'review')
      throw new Error('Recovery must not authorize preparation');
    expect(recoveredView.recovery).toMatchObject({
      status: 'prepared',
      reservation: 'retained',
      retry: 'not_authorized',
    });
    expect(test.preparedCommands()).toHaveLength(1);
    expect(getCsrfToken).toHaveBeenCalledTimes(1);
    signedIn = false;
    await expect(reloaded.recover()).rejects.toThrow(
      'Cancellation unavailable'
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  } finally {
    await server.close();
  }
});
