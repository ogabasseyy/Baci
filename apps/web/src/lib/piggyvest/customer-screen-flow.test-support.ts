import { createHash } from 'node:crypto';
import { createPiggyvestPolicyClient } from '@baci/shared/lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { expect, vi } from 'vitest';
import { checkCsrfProtection } from '@/lib/csrf';
import { createPiggyvestCustomerScreenRuntime } from './customer-screen-runtime';
import { GOAL_POLICY_STATEMENTS } from './goal-policy-store-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function customerScreenFlowFixture(
  database?: PiggyvestProvisioningExecutor
) {
  const merchantId = '10000000-0000-4000-8000-000000000001';
  const customerId = '20000000-0000-4000-8000-000000000001';
  const goalId = database
    ? '30000000-0000-4000-8000-000000000106'
    : '30000000-0000-4000-8000-000000000001';
  const actorId = '90000000-0000-4000-8000-000000000001';
  const revisionId = '70000000-0000-4000-8000-000000000001';
  const text = 'Synthetic integration terms. Not a customer agreement.';
  const terms = {
    text,
    version: 'synthetic-v1',
    hash: createHash('sha256').update(text).digest('hex'),
  };
  let signedIn = true;
  let accepted = false;
  const getUser = vi.fn(async () => ({
    data: { user: signedIn ? { id: actorId } : null },
    error: null,
  }));
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
  const execute = vi.fn((statement: string, parameters: readonly unknown[]) => {
    expect(parameters.slice(1, 4)).toEqual([merchantId, customerId, goalId]);
    if (statement === GOAL_POLICY_STATEMENTS.acceptGoalPolicy.text) {
      expect(parameters.slice(5)).toEqual([revisionId, actorId]);
      accepted = true;
      return Promise.resolve({
        rows: [{ result: { revisionId, outcome: 'accepted' } }],
      });
    }
    expect(statement).toBe(GOAL_POLICY_STATEMENTS.readGoalPolicy.text);
    return Promise.resolve({
      rows: [
        {
          result: {
            revisionId,
            command: {
              revisionId,
              expectedGoalUpdatedAt: '2026-09-12T00:00:00Z',
              productId: '50000000-0000-4000-8000-000000000001',
              variantId: null,
              termsVersion: terms.version,
              termsHash: terms.hash,
              quoteId: 'synthetic-private-quote',
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
            actorId: accepted ? actorId : null,
            acceptedAt: accepted ? '2026-09-12T01:00:00Z' : null,
          },
        },
      ],
    });
  });
  const runtime = createPiggyvestCustomerScreenRuntime({
    supabase: { auth: { getUser }, from } as unknown as SupabaseClient,
    goalId,
    configuration: {
      environment: 'staging',
      transport: 'local_test',
      merchantId,
      integrationId: '40000000-0000-4000-8000-000000000001',
      expectedBusinessId: database
        ? 'synthetic-business'
        : 'synthetic-private-business',
      expectedProjectId: 'synthetic',
      actualProjectId: 'synthetic',
      allowlistedMerchantIds: [merchantId],
      allowlistedCustomerIds: [customerId],
    },
    termsDocument: terms,
    execute: database ?? execute,
    checkCsrfProtection,
  });
  const endpoint = 'http://127.0.0.1:3000/local/policy';
  const localFetch = vi.fn<typeof fetch>(async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set('cookie', 'csrf-token=synthetic-csrf');
    const request = new NextRequest(String(url), {
      ...init,
      headers,
      signal: init?.signal ?? undefined,
    });
    const response = await (init?.method === 'POST'
      ? runtime.POST(request)
      : runtime.GET(request));
    Object.defineProperty(response, 'url', { value: String(url) });
    return response;
  });
  const client = createPiggyvestPolicyClient({
    configuration: {
      mode: 'local_test',
      baseUrl: 'http://127.0.0.1:3000',
      endpointPath: '/local/policy',
    },
    fetch: localFetch,
    getCsrfToken: async () => 'synthetic-csrf',
  });
  const readScreen = () =>
    runtime.readScreen(new NextRequest(`${endpoint}?goalId=${goalId}`));
  return {
    terms,
    revisionId,
    client,
    readScreen,
    execute,
    rows,
    goalId,
    localFetch,
    signOut: () => {
      signedIn = false;
    },
  };
}
