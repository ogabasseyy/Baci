import { piggyvestCancellationReviewSchemas as schemas } from '@baci/shared/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { expect, vi } from 'vitest';
import { checkCsrfProtection } from '@/lib/csrf';
import { CANCEL_PLAN_STATEMENTS } from './cancel-plan-statements';
import { createPiggyvestCustomerCancelHandler } from './customer-cancel-handler';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function customerCancelFlowFixture(
  options: { sequence?: number; database?: PiggyvestProvisioningExecutor } = {}
) {
  const sequence = String(options.sequence ?? 201).padStart(12, '0');
  const goalId = `30000000-0000-4000-8000-${sequence}`;
  const revisionId = `70000000-0000-4000-8000-${sequence}`;
  const operationId = `80000000-0000-4000-8000-${sequence}`;
  const merchantId = '10000000-0000-4000-8000-000000000001';
  const customerId = '20000000-0000-4000-8000-000000000001';
  const actorId = '90000000-0000-4000-8000-000000000001';
  const endpoint = 'http://127.0.0.1:3000/local/cancellation';
  const events: string[] = [];
  let signedIn = true;
  const getUser = vi.fn(() => {
    events.push('auth');
    return Promise.resolve({
      data: { user: signedIn ? { id: actorId } : null },
      error: null,
    });
  });
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
    events.push(table);
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: rows[table], error: null })),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    return query;
  });
  const execute = vi.fn<PiggyvestProvisioningExecutor>(
    (statement, parameters) => {
      events.push('sql');
      expect(parameters.slice(1, 4)).toEqual([merchantId, customerId, goalId]);
      if (options.database) return options.database(statement, parameters);
      if (statement === CANCEL_PLAN_STATEMENTS.prepareCancelPlan.text) {
        const command = JSON.parse(String(parameters[5])) as Record<
          string,
          unknown
        >;
        return Promise.resolve({
          rows: [
            {
              result: {
                status: 'prepared',
                operationId: command.operationId,
                collectionPaused: true,
                dispatch: 'contract_gap',
                interestDisposition: 'unresolved',
              },
            },
          ],
        });
      }
      expect(statement).toBe(CANCEL_PLAN_STATEMENTS.quoteCancelPlan.text);
      return Promise.resolve({
        rows: [
          {
            result: {
              policy: {
                revisionId,
                command: {
                  revisionId,
                  expectedGoalUpdatedAt: '2026-09-12T00:00:00Z',
                  productId: '50000000-0000-4000-8000-000000000001',
                  variantId: null,
                  termsVersion: 'synthetic-v1',
                  termsHash: 'a'.repeat(64),
                  quoteId: 'synthetic-quote',
                  quoteKobo: 100000,
                  quoteExpiresAt: '2099-01-01T00:00:00Z',
                  guarantee: null,
                  lifecycle: 'draft',
                  collectionPaused: true,
                },
                device: {
                  name: 'Synthetic phone',
                  condition: 'New',
                  variantId: null,
                  variantLabel: null,
                  selectionStatus: 'exact',
                },
                actorId,
                acceptedAt: '2026-09-12T01:00:00Z',
              },
              ledgerSnapshot: {
                ledger: {
                  confirmedPrincipalKobo: 100,
                  reservedPrincipalKobo: 0,
                  paidEligibleInterestKobo: 7,
                  reservedPaidInterestKobo: 0,
                  pendingInterestKobo: 3,
                },
                activeReservation: null,
                fundingReversed: false,
              },
            },
          },
        ],
      });
    }
  );
  const csrf = vi.fn((request: NextRequest) => {
    events.push('csrf');
    return checkCsrfProtection(request);
  });
  const handler = createPiggyvestCustomerCancelHandler({
    supabase: { auth: { getUser }, from } as unknown as SupabaseClient,
    goalId,
    configuration: {
      environment: 'staging',
      transport: 'local_test',
      merchantId,
      integrationId: '40000000-0000-4000-8000-000000000001',
      expectedBusinessId: 'synthetic-business',
      expectedProjectId: 'synthetic',
      actualProjectId: 'synthetic',
      allowlistedMerchantIds: [merchantId],
      allowlistedCustomerIds: [customerId],
    },
    execute,
    checkCsrfProtection: csrf,
  });
  const localFetch = vi.fn<typeof fetch>(async (url, init) => {
    const address = new URL(String(url));
    expect(address.origin + address.pathname).toBe(endpoint);
    const headers = new Headers(init?.headers);
    headers.set('cookie', 'csrf-token=synthetic-csrf');
    const request = new NextRequest(String(url), {
      ...init,
      headers,
      signal: init?.signal ?? undefined,
    });
    const response = await (init?.method === 'POST'
      ? handler.POST(request)
      : handler.GET(request));
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  const postRaw = (input: unknown, withCsrf = true) =>
    localFetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(withCsrf ? { 'x-csrf-token': 'synthetic-csrf' } : {}),
      },
      body: JSON.stringify(input),
    });
  const prepare = vi.fn(async (input: unknown) => {
    const response = await postRaw(input);
    if (!response.ok) throw new Error('Cancellation unavailable');
    return schemas.receipt.parse(await response.json());
  });
  return {
    goalId,
    operationId,
    actorId,
    events,
    execute,
    from,
    csrf,
    prepare,
    postRaw,
    async load() {
      const response = await localFetch(`${endpoint}?goalId=${goalId}`, {
        method: 'GET',
      });
      if (!response.ok) throw new Error('Cancellation unavailable');
      return schemas.quote.parse(await response.json());
    },
    publicCommands() {
      return localFetch.mock.calls
        .filter(([, init]) => init?.method === 'POST')
        .map(
          ([, init]) =>
            JSON.parse(String(init?.body)) as Record<string, unknown>
        );
    },
    preparedCommands() {
      return execute.mock.calls
        .filter(
          ([statement]) =>
            statement === CANCEL_PLAN_STATEMENTS.prepareCancelPlan.text
        )
        .map(
          ([, parameters]) =>
            JSON.parse(String(parameters[5])) as Record<string, unknown>
        );
    },
    assertOnlyCancellationSql() {
      expect(
        execute.mock.calls.every(([statement]) =>
          new Set<string>([
            CANCEL_PLAN_STATEMENTS.quoteCancelPlan.text,
            CANCEL_PLAN_STATEMENTS.prepareCancelPlan.text,
          ]).has(statement)
        )
      ).toBe(true);
    },
    signOut() {
      signedIn = false;
    },
  };
}
