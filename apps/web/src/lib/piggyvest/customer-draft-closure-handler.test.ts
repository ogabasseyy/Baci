import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { createPiggyvestCustomerDraftClosureHandler } from './customer-draft-closure-handler';
import { DRAFT_CLOSURE_STATEMENTS } from './draft-closure-statements';

vi.mock('server-only', () => ({}));
const goalId = 'abcdefab-0000-4000-8000-000000000801';
const actorId = '90000000-0000-4000-8000-000000000001';
const merchantId = '10000000-0000-4000-8000-000000000001';
const customerId = '20000000-0000-4000-8000-000000000001';
const configuration = {
  environment: 'staging',
  transport: 'local_test',
  integrationId: '40000000-0000-4000-8000-000000000001',
  expectedBusinessId: 'synthetic-business',
  merchantId,
  allowlistedMerchantIds: [merchantId],
  allowlistedCustomerIds: [customerId],
  expectedProjectId: 'synthetic',
  actualProjectId: 'synthetic',
};
const review = {
  goalId,
  revisionId: goalId,
  termsVersion: 'synthetic-v1',
  termsHash: 'a'.repeat(64),
};
const command = { ...review, operationId: goalId, accepted: true };
const closed = {
  ...review,
  status: 'closed',
  operationId: goalId,
  action: 'close_plan',
  closedAt: '2026-09-12T10:00:00+00:00',
  refundIssued: false,
  providerWalletDeleted: false,
};
function fixture(config: unknown = configuration) {
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
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: rows[table], error: null })),
    };
    return query;
  });
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: closed }] });
  const checkCsrfProtection = vi.fn().mockResolvedValue({ valid: true });
  const handler = createPiggyvestCustomerDraftClosureHandler({
    supabase: { auth: { getUser }, from } as unknown as SupabaseClient,
    goalId,
    configuration: config,
    execute,
    checkCsrfProtection,
  });
  return { handler, getUser, from, execute, checkCsrfProtection, rows };
}
function post(body: unknown = command) {
  return new NextRequest('http://localhost/close-plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
it('authenticates before body, configuration, CSRF or database work', async () => {
  const test = fixture();
  test.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await test.handler.POST(post())).status).toBe(401);
  expect(test.from).not.toHaveBeenCalled();
  expect(test.checkCsrfProtection).not.toHaveBeenCalled();
  expect(test.execute).not.toHaveBeenCalled();
});
it('requires CSRF and an isolated approved configuration', async () => {
  const csrf = fixture();
  csrf.checkCsrfProtection.mockResolvedValue({ valid: false });
  expect((await csrf.handler.POST(post())).status).toBe(403);
  expect(csrf.execute).not.toHaveBeenCalled();
  const disabled = fixture({});
  expect((await disabled.handler.POST(post())).status).toBe(403);
  expect(disabled.execute).not.toHaveBeenCalled();
});
it('returns only an exact persisted closure acknowledgement', async () => {
  const test = fixture();
  const response = await test.handler.POST(post());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual(closed);
  expect(test.execute).toHaveBeenCalledWith(
    DRAFT_CLOSURE_STATEMENTS.closeUnfundedDraft.text,
    [
      configuration.integrationId,
      merchantId,
      customerId,
      goalId,
      'synthetic-business',
      actorId,
      JSON.stringify(command),
    ]
  );
});
it.each([
  { actorId },
  { accepted: false },
  { providerZero: true },
  { walletId: goalId },
])('rejects injected authority %j', async (extra) => {
  const test = fixture();
  expect((await test.handler.POST(post({ ...command, ...extra }))).status).toBe(
    400
  );
  expect(test.execute).not.toHaveBeenCalled();
});
it('keeps mapped-wallet reconciliation explicit without terminal claims', async () => {
  const test = fixture();
  const blocked = {
    status: 'requires_reconciliation',
    goalId,
    reason: 'provider_zero_unverified',
  };
  test.execute.mockResolvedValue({ rows: [{ result: blocked }] });
  expect(
    await (
      await test.handler.GET(
        new NextRequest(`http://localhost/close-plan?goalId=${goalId}`)
      )
    ).json()
  ).toEqual(blocked);
});
it.each([
  { goalId: actorId },
  { revisionId: actorId },
  { termsHash: 'b'.repeat(64) },
  { leakedAccount: '1234567890' },
])('rejects stale or overbroad acknowledgement %j', async (extra) => {
  const test = fixture();
  test.execute.mockResolvedValue({
    rows: [{ result: { ...closed, ...extra } }],
  });
  const response = await test.handler.POST(post());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    status: 'unconfirmed',
    goalId,
    readbackRequired: true,
  });
});
it('redacts a possibly committed database failure and revalidates current actor', async () => {
  const test = fixture();
  test.execute.mockRejectedValue(new Error('private account 1234567890'));
  expect(
    JSON.stringify(await (await test.handler.POST(post())).json())
  ).not.toContain('1234567890');
  test.execute.mockImplementation(async () => {
    test.getUser.mockResolvedValue({
      data: { user: { id: customerId } },
      error: null,
    });
    return { rows: [{ result: closed }] };
  });
  expect((await test.handler.POST(post())).status).toBe(503);
});
it('compares UUID identity case-insensitively without rewriting the stored command', async () => {
  const test = fixture();
  expect(
    (
      await test.handler.GET(
        new NextRequest(
          `http://localhost/close-plan?goalId=${goalId.toUpperCase()}`
        )
      )
    ).status
  ).toBe(200);
  const uppercase = {
    ...command,
    goalId: goalId.toUpperCase(),
    revisionId: goalId.toUpperCase(),
    operationId: goalId.toUpperCase(),
  };
  const response = await test.handler.POST(post(uppercase));
  expect(response.status).toBe(200);
  expect(test.execute.mock.calls.at(-1)?.[1]?.[6]).toBe(
    JSON.stringify(uppercase)
  );
});
