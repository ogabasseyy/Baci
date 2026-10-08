import { createPiggyvestCancellationClientBinding } from '@baci/shared/lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { createCancellationRecoveryHandler } from '@/lib/piggyvest/cancellation-recovery';
import { customerCancelFlowFixture } from '@/lib/piggyvest/customer-cancel-flow.test-support';
import { BoundCancellationReview } from './cancellation-binding';

vi.mock('server-only', () => ({}));

it('crosses client, real auth/CSRF handlers and UI, then recovers a lost preparation response without resend', async () => {
  const test = customerCancelFlowFixture();
  const quote = await test.load();
  if (quote.status !== 'quote_available') throw new Error('fixture');
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
  const getUser = vi.fn(async () => ({
    data: { user: signedIn ? { id: test.actorId } : null },
    error: null,
  }));
  const recovery = createCancellationRecoveryHandler({
    goalId: test.goalId,
    supabase: {
      auth: { getUser },
      from: test.from,
    } as unknown as SupabaseClient,
    configuration: {
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
    execute: async (_statement, parameters) => ({
      rows: [
        {
          result: {
            status: 'prepared',
            goalId: test.goalId,
            requestedOperationId: parameters[6],
            operationId: test.operationId,
            retry: 'not_authorized',
            dispatch: 'contract_gap',
            reservation: 'retained',
            interestDisposition: 'unresolved',
            originalDisclosure: {
              revisionId: quote.revisionId,
              termsVersion: quote.termsVersion,
              termsHash: quote.termsHash,
              consentVersion: quote.consentVersion,
              principalKobo: quote.principalKobo,
              paidInterestKobo: quote.paidInterestKobo,
              pendingInterestKobo: quote.pendingInterestKobo,
            },
          },
        },
      ],
    }),
  });
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    let response: Response;
    if (String(url).includes('/recovery'))
      response = await recovery.GET(
        new NextRequest(String(url), {
          ...init,
          signal: init?.signal ?? undefined,
        })
      );
    else if (init?.method === 'POST') {
      response = await test.postRaw(
        JSON.parse(String(init.body)),
        new Headers(init.headers).get('x-csrf-token') === 'synthetic-csrf'
      );
      expect(response.status).toBe(200);
      throw new Error('synthetic response loss after server preparation');
    } else response = Response.json(await test.load());
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  const getCsrfToken = vi.fn(async () => 'synthetic-csrf');
  const http = {
    configuration: {
      mode: 'local_test',
      baseUrl: 'http://127.0.0.1:3000',
      endpointPath: '/local/cancellation',
      recoveryEndpointPath: '/recovery',
      credentials: 'include',
    },
    fetch,
    getCsrfToken,
  };
  const controller = await createPiggyvestCancellationClientBinding({
    mode: 'prepare',
    source,
    tenantKey: 'synthetic-tenant',
    operationId: test.operationId,
    http,
    isCurrent: () => signedIn,
  });
  const view = render(
    <BoundCancellationReview source={source} binding={controller} />
  );
  fireEvent.click(screen.getByRole('checkbox'));
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Prepare cancellation' })
    );
  });
  expect(test.publicCommands()).toHaveLength(1);
  await expect(test.csrf.mock.results[0]?.value).resolves.toMatchObject({
    valid: true,
  });
  await waitFor(() => expect(test.preparedCommands()).toHaveLength(1));
  expect(test.csrf).toHaveBeenCalledTimes(1);
  view.unmount();
  const countBeforeReload = fetch.mock.calls.length;
  const reloaded = await createPiggyvestCancellationClientBinding({
    mode: 'recovery',
    source,
    tenantKey: 'synthetic-tenant',
    http,
    isCurrent: () => signedIn,
  });
  expect(fetch).toHaveBeenCalledTimes(countBeforeReload);
  render(<BoundCancellationReview source={source} binding={reloaded} />);
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh cancellation status' })
    );
  });
  expect(screen.getByText(/Principal reservation retained/)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Prepare cancellation' })
  ).toBeNull();
  expect(test.preparedCommands()).toHaveLength(1);
  expect(getUser).toHaveBeenCalled();
  expect(getCsrfToken).toHaveBeenCalledTimes(1);
  signedIn = false;
  await expect(reloaded.recover()).rejects.toThrow('Cancellation unavailable');
});
