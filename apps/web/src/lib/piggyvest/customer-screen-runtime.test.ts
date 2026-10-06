import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createPiggyvestCustomerScreenRuntime } from './customer-screen-runtime';
import { GOAL_POLICY_STATEMENTS } from './goal-policy-store-statements';

vi.mock('server-only', () => ({}));

function fixture() {
  const goalId = '30000000-0000-4000-8000-000000000001';
  const merchantId = '10000000-0000-4000-8000-000000000001';
  const customerId = '20000000-0000-4000-8000-000000000001';
  const actorId = '90000000-0000-4000-8000-000000000001';
  const revisionId = '70000000-0000-4000-8000-000000000001';
  const terms = {
    version: 'synthetic-v1',
    text: 'Synthetic test terms only.',
    hash: createHash('sha256')
      .update('Synthetic test terms only.')
      .digest('hex'),
  };
  const events: string[] = [];
  const rows: Record<string, unknown> = {
    merchants: { id: merchantId },
    customers: { id: customerId, merchant_id: merchantId, user_id: actorId },
    customer_savings_goals: {
      id: goalId,
      merchant_id: merchantId,
      customer_id: customerId,
    },
  };
  const getUser = vi.fn(async () => {
    events.push('auth');
    return { data: { user: { id: actorId } }, error: null };
  });
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
  let accepted = false;
  const execute = vi.fn(
    async (statement: string, parameters: readonly unknown[]) => {
      events.push('store');
      expect(parameters.slice(1, 4)).toEqual([merchantId, customerId, goalId]);
      if (statement === GOAL_POLICY_STATEMENTS.acceptGoalPolicy.text) {
        expect(parameters.slice(5)).toEqual([revisionId, actorId]);
        accepted = true;
        return { rows: [{ result: { revisionId, outcome: 'accepted' } }] };
      }
      expect(statement).toBe(GOAL_POLICY_STATEMENTS.readGoalPolicy.text);
      return {
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
      };
    }
  );
  const options = {
    supabase: { auth: { getUser }, from } as unknown as SupabaseClient,
    goalId,
    configuration: {
      environment: 'staging',
      transport: 'local_test',
      merchantId,
      integrationId: '40000000-0000-4000-8000-000000000001',
      expectedBusinessId: 'synthetic-private-business',
      expectedProjectId: 'synthetic',
      actualProjectId: 'synthetic',
      allowlistedMerchantIds: [merchantId],
      allowlistedCustomerIds: [customerId],
    },
    termsDocument: terms,
    execute,
    checkCsrfProtection: vi.fn(async () => {
      events.push('csrf');
      return { valid: true };
    }),
  };
  const acceptance = {
    goalId,
    revisionId,
    termsVersion: terms.version,
    termsHash: terms.hash,
    accepted: true,
  };
  const get = (selected = goalId) =>
    new NextRequest(`http://localhost/policy?goalId=${selected}`);
  const post = (input: unknown = acceptance) =>
    new NextRequest('http://localhost/policy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  return {
    options,
    events,
    rows,
    getUser,
    from,
    execute,
    acceptance,
    get,
    post,
    runtime: createPiggyvestCustomerScreenRuntime(options),
  };
}

describe('local customer screen runtime', () => {
  it('fails closed on invalid store output and does not expose executor errors', async () => {
    const test = fixture();
    test.execute.mockResolvedValueOnce({ rows: [] });
    expect(await test.runtime.readScreen(test.get())).toEqual({
      environment: 'staging',
      status: 'unavailable',
    });
    test.execute.mockRejectedValueOnce(new Error('synthetic-private-store'));
    const response = await test.runtime.GET(test.get());
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Policy unavailable' });
  });

  it('persists exact draft consent through real handler/store without financial readiness', async () => {
    const test = fixture();
    const before = await test.runtime.readScreen(test.get());
    expect(before.status).toBe('ready');
    const response = await test.runtime.POST(test.post());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ consent: 'accepted' });
    const after = await test.runtime.readScreen(test.get());
    expect(after).toMatchObject({
      status: 'ready',
      policy: {
        consent: 'accepted',
        device: {
          productName: 'Synthetic phone',
          variant: null,
          condition: 'New',
        },
      },
      eligibility: { status: 'unavailable' },
      funding: { status: 'unavailable' },
      progress: { status: 'unavailable' },
    });
    expect(test.events[0]).toBe('auth');
    const serialized = JSON.stringify(after);
    for (const forbidden of [
      'synthetic-private',
      'quoteKobo',
      'actorId',
      'customerId',
      test.options.configuration.merchantId,
    ])
      expect(serialized).not.toContain(forbidden);
    if (before.status !== 'ready' || after.status !== 'ready')
      throw new Error('Missing source');
    expect(after.sessionKey).not.toBe(before.sessionKey);
    expect(after.sessionKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('authenticates before CSRF or malformed body processing', async () => {
    const test = fixture();
    test.getUser.mockRejectedValue(new Error('synthetic-private-auth'));
    const response = await test.runtime.POST(test.post(null));
    expect(response.status).toBe(401);
    expect(test.options.checkCsrfProtection).not.toHaveBeenCalled();
    expect(test.from).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
    expect(await test.runtime.readScreen(test.get())).toEqual({
      environment: 'staging',
      status: 'unauthenticated',
    });
  });

  it.each([
    'customers',
    'merchants',
    'customer_savings_goals',
  ])('rejects cross-scope %s rows before persistence', async (table) => {
    const test = fixture();
    const row = test.rows[table];
    const field = table === 'customers' ? 'user_id' : 'id';
    test.rows[table] = {
      ...(row as Record<string, unknown>),
      [field]: '80000000-0000-4000-8000-000000000001',
    };
    expect((await test.runtime.POST(test.post())).status).toBe(403);
    expect(await test.runtime.readScreen(test.get())).toEqual({
      environment: 'staging',
      status: 'unavailable',
    });
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('rejects a different otherwise-owned goal than the server-bound goal', async () => {
    const test = fixture();
    const other = '30000000-0000-4000-8000-000000000002';
    test.rows.customer_savings_goals = {
      id: other,
      merchant_id: test.options.configuration.merchantId,
      customer_id: test.options.configuration.allowlistedCustomerIds[0],
    };
    expect((await test.runtime.GET(test.get(other))).ok).toBe(false);
    expect(
      (
        await test.runtime.POST(
          test.post({ ...test.acceptance, goalId: other })
        )
      ).ok
    ).toBe(false);
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('rejects changed identity between authentication and store access', async () => {
    const test = fixture();
    test.getUser.mockResolvedValueOnce({
      data: { user: { id: '90000000-0000-4000-8000-000000000002' } },
      error: null,
    });
    expect((await test.runtime.POST(test.post())).ok).toBe(false);
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('revalidates identity before returning a completed projection', async () => {
    const test = fixture();
    const execute = test.options.execute;
    test.options.execute = vi.fn(async (statement, parameters) => {
      const result = await execute(statement, parameters);
      test.getUser.mockRejectedValue(new Error('logged out'));
      return result;
    });
    const runtime = createPiggyvestCustomerScreenRuntime(test.options);
    expect(await runtime.readScreen(test.get())).toEqual({
      environment: 'staging',
      status: 'unavailable',
    });
  });

  it('revalidates goal ownership between draft read and acceptance', async () => {
    const test = fixture();
    const execute = test.options.execute;
    test.options.execute = vi.fn(async (statement, parameters) => {
      const result = await execute(statement, parameters);
      test.rows.customer_savings_goals = null;
      return result;
    });
    const runtime = createPiggyvestCustomerScreenRuntime(test.options);
    expect((await runtime.POST(test.post())).ok).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    'production',
    'tls',
  ])('rejects nonlocal configuration %s', async (value) => {
    const test = fixture();
    test.options.configuration.transport = value;
    expect((await test.runtime.GET(test.get())).ok).toBe(false);
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('retains CSRF, revision and bounded-input rejection from the handler', async () => {
    const test = fixture();
    test.options.checkCsrfProtection.mockImplementationOnce(async () => {
      test.events.push('csrf');
      return { valid: false };
    });
    expect((await test.runtime.POST(test.post())).status).toBe(403);
    expect(test.events.slice(0, 2)).toEqual(['auth', 'csrf']);
    expect(
      (
        await test.runtime.POST(
          test.post({ ...test.acceptance, termsHash: 'a'.repeat(64) })
        )
      ).status
    ).toBe(409);
    expect(
      (
        await test.runtime.POST(
          test.post({ ...test.acceptance, extra: 'x'.repeat(20000) })
        )
      ).status
    ).toBe(400);
    expect(
      test.execute.mock.calls.every(
        ([statement]) =>
          statement !== GOAL_POLICY_STATEMENTS.acceptGoalPolicy.text
      )
    ).toBe(true);
  });
});
