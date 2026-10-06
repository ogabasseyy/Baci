import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { PolicyPanel } from '@/components/storefront/piggyvest-savings/policy-panel';
import { checkCsrfProtection } from '@/lib/csrf';
import { createPiggyvestCustomerPolicyHandler } from './customer-policy-handler';
import { GOAL_POLICY_STATEMENTS } from './goal-policy-store-statements';

vi.mock('server-only', () => ({}));

function fixture() {
  const goalId = '30000000-0000-4000-8000-000000000001';
  const merchantId = '10000000-0000-4000-8000-000000000001';
  const customerId = '20000000-0000-4000-8000-000000000001';
  const actorId = '90000000-0000-4000-8000-000000000001';
  const revisionId = '70000000-0000-4000-8000-000000000001';
  const text = 'Synthetic draft document, not customer business terms.';
  const termsDocument = {
    text,
    version: 'synthetic-v1',
    hash: createHash('sha256').update(text).digest('hex'),
  };
  const command = {
    revisionId,
    expectedGoalUpdatedAt: '2026-09-12T00:00:00Z',
    productId: '50000000-0000-4000-8000-000000000001',
    variantId: null,
    termsVersion: termsDocument.version,
    termsHash: termsDocument.hash,
    quoteId: 'synthetic-quote',
    quoteKobo: 100000,
    quoteExpiresAt: '2099-01-01T00:00:00Z',
    guarantee: null,
    lifecycle: 'draft',
    collectionPaused: true,
  };
  let accepted = false;
  const execute = vi.fn(
    async (statement: string, parameters: readonly unknown[]) => {
      if (statement === GOAL_POLICY_STATEMENTS.acceptGoalPolicy.text) {
        expect(parameters[5]).toBe(revisionId);
        expect(parameters[6]).toBe(actorId);
        accepted = true;
        return { rows: [{ result: { revisionId, outcome: 'accepted' } }] };
      }
      expect(statement).toBe(GOAL_POLICY_STATEMENTS.readGoalPolicy.text);
      return {
        rows: [
          {
            result: {
              revisionId,
              command,
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
  const getUser = vi.fn(async () => ({
    data: { user: { id: actorId } },
    error: null,
  }));
  const supabase = { auth: { getUser }, from } as unknown as SupabaseClient;
  const handler = createPiggyvestCustomerPolicyHandler({
    authenticate: vi.fn(async () => supabase),
    checkCsrfProtection,
    execute,
    termsDocument,
    configuration: {
      environment: 'staging',
      transport: 'local_test',
      merchantId,
      integrationId: '40000000-0000-4000-8000-000000000001',
      expectedBusinessId: 'synthetic-business',
      expectedProjectId: 'synthetic-project',
      actualProjectId: 'synthetic-project',
      allowlistedMerchantIds: [merchantId],
      allowlistedCustomerIds: [customerId],
    },
  });
  const url = 'http://localhost/api/synthetic-policy';
  const load = async (selectedGoal: string, signal: AbortSignal) => {
    const response = await handler.GET(
      new NextRequest(`${url}?goalId=${selectedGoal}`, { signal })
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    if (!response.ok) throw new Error('Read unavailable');
    return response.json();
  };
  const submit = async (input: unknown, withCsrf = true) => {
    const response = await handler.POST(
      new NextRequest(url, {
        method: 'POST',
        body: JSON.stringify(input),
        headers: {
          'content-type': 'application/json',
          ...(withCsrf
            ? {
                cookie: 'csrf-token=synthetic-csrf-value',
                'x-csrf-token': 'synthetic-csrf-value',
              }
            : {}),
        },
      })
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    if (!response.ok) throw new Error('Acceptance unavailable');
    return response.json();
  };
  return {
    goalId,
    revisionId,
    termsDocument,
    load,
    submit,
    execute,
    from,
    getUser,
    rows,
  };
}

it('connects concrete RLS resolution, cookie CSRF, handler and review UI without activation', async () => {
  const test = fixture();
  render(
    <PolicyPanel
      sessionKey="synthetic-session"
      goalId={test.goalId}
      load={test.load}
      submit={test.submit}
    />
  );
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Accept draft terms' }));
  await screen.findByText('Consent recorded for this draft.');
  expect(test.getUser).toHaveBeenCalledTimes(2);
  expect(test.execute).toHaveBeenCalledTimes(3);
  expect(
    test.execute.mock.calls.every(
      ([statement]) =>
        statement === GOAL_POLICY_STATEMENTS.readGoalPolicy.text ||
        statement === GOAL_POLICY_STATEMENTS.acceptGoalPolicy.text
    )
  ).toBe(true);
  expect(document.body.textContent).not.toContain('100000');
});

it('refuses acceptance without the actual CSRF cookie/header check', async () => {
  const test = fixture();
  await expect(
    test.submit(
      {
        goalId: test.goalId,
        revisionId: test.revisionId,
        termsVersion: test.termsDocument.version,
        termsHash: test.termsDocument.hash,
        accepted: true,
      },
      false
    )
  ).rejects.toThrow('Acceptance unavailable');
  expect(test.execute).not.toHaveBeenCalled();
});

it('refuses a goal owned by another customer before private policy access', async () => {
  const test = fixture();
  test.rows.customer_savings_goals = {
    id: test.goalId,
    merchant_id: '10000000-0000-4000-8000-000000000001',
    customer_id: '20000000-0000-4000-8000-000000000099',
  };
  await expect(
    test.load(test.goalId, new AbortController().signal)
  ).rejects.toThrow('Read unavailable');
  expect(test.execute).not.toHaveBeenCalled();
});
