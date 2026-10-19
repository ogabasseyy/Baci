import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';
import { createPiggyvestCustomerPolicyHandler } from './customer-policy-handler';
import { GOAL_LIFECYCLE_STATEMENTS } from './goal-lifecycle-statements';

vi.mock('./customer-policy-context', () => ({
  resolvePiggyvestCustomerPolicyContext: vi.fn(),
}));
const uuid = '10000000-0000-4000-8000-000000000001';
const scope = {
  environment: 'staging' as const,
  integrationId: uuid,
  merchantId: uuid,
  customerId: uuid,
  goalId: uuid,
  expectedBusinessId: 'synthetic-business',
};
const terms = {
  version: 'synthetic-v1',
  text: 'Synthetic duration terms only.',
  hash: createHash('sha256')
    .update('Synthetic duration terms only.')
    .digest('hex'),
};
const command = {
  revisionId: uuid,
  expectedGoalUpdatedAt: '2026-09-12T00:00:00Z',
  productId: uuid,
  variantId: null,
  termsVersion: terms.version,
  termsHash: terms.hash,
  quoteId: 'synthetic',
  quoteKobo: 100001,
  quoteExpiresAt: '2099-01-01T00:00:00Z',
  guarantee: null,
  lifecycle: 'draft',
  collectionPaused: true,
};
const snapshot = {
  revisionId: uuid,
  command,
  device: {
    name: 'Synthetic',
    condition: 'new',
    variantId: null,
    variantLabel: null,
    selectionStatus: 'exact',
  },
  actorId: null,
  acceptedAt: null,
  durationMonths: 1,
};
const body = {
  goalId: uuid,
  revisionId: uuid,
  termsVersion: terms.version,
  termsHash: terms.hash,
  accepted: true,
};
beforeEach(() => {
  vi.mocked(resolvePiggyvestCustomerPolicyContext).mockResolvedValue({
    status: 'ready',
    configuration: scope,
    actorId: uuid,
  });
});
function fixture(stored: unknown = snapshot) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ result: stored }] })
    .mockResolvedValue({
      rows: [
        {
          result: { revisionId: uuid, durationMonths: 1, outcome: 'accepted' },
        },
      ],
    });
  const handler = createPiggyvestCustomerPolicyHandler({
    authenticate: async () => ({}) as SupabaseClient,
    checkCsrfProtection: async () => ({ valid: true }),
    configuration: {},
    termsDocument: terms,
    execute,
  });
  return { handler, execute };
}
function post(input: unknown) {
  return new NextRequest('https://synthetic.invalid/policy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
it('reads prepared duration with exact draft terms', async () => {
  const { handler } = fixture();
  const response = await handler.GET(
    new NextRequest(`https://synthetic.invalid/policy?goalId=${uuid}`)
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({
    durationMonths: 1,
    consent: 'required',
    terms,
  });
});
it.each([
  undefined,
  2,
])('rejects missing or mismatched duration %s without a receipt', async (durationMonths) => {
  const { handler, execute } = fixture();
  const response = await handler.POST(post({ ...body, durationMonths }));
  expect(response.status).toBe(409);
  expect(execute).toHaveBeenCalledOnce();
});
it('records lifecycle duration consent rather than a generic receipt', async () => {
  const { handler, execute } = fixture();
  const response = await handler.POST(post({ ...body, durationMonths: 1 }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    durationMonths: 1,
    consent: 'accepted',
  });
  expect(execute).toHaveBeenLastCalledWith(
    GOAL_LIFECYCLE_STATEMENTS.acceptGoalLifecycleTerms.text,
    [uuid, uuid, uuid, uuid, 'synthetic-business', uuid, uuid, 1]
  );
});
it('does not accept caller-invented duration for a generic draft', async () => {
  const { durationMonths: _duration, ...generic } = snapshot;
  const { handler, execute } = fixture(generic);
  expect(
    (await handler.POST(post({ ...body, durationMonths: 1 }))).status
  ).toBe(409);
  expect(execute).toHaveBeenCalledOnce();
});
