import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';
import { createPiggyvestCustomerPolicyHandler } from './customer-policy-handler';

vi.mock('./customer-policy-context', () => ({
  resolvePiggyvestCustomerPolicyContext: vi.fn(),
}));
const scope = {
  environment: 'staging' as const,
  integrationId: '40000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '20000000-0000-4000-8000-000000000001',
  goalId: '30000000-0000-4000-8000-000000000001',
  expectedBusinessId: 'synthetic-business',
};
const actorId = '90000000-0000-4000-8000-000000000001';
const termsDocument = {
  version: 'synthetic-v1',
  text: 'Synthetic test fixture only; no business terms.',
  hash: createHash('sha256')
    .update('Synthetic test fixture only; no business terms.')
    .digest('hex'),
};
const command = {
  revisionId: '70000000-0000-4000-8000-000000000001',
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
const stored = {
  revisionId: command.revisionId,
  command,
  device: {
    name: 'Synthetic phone',
    condition: 'new',
    variantId: null,
    variantLabel: null,
    selectionStatus: 'exact',
  },
  actorId: null,
  acceptedAt: null,
};
const body = {
  goalId: scope.goalId,
  revisionId: command.revisionId,
  termsVersion: termsDocument.version,
  termsHash: termsDocument.hash,
  accepted: true,
};
const configuration = {
  environment: 'staging',
  transport: 'local_test',
  integrationId: scope.integrationId,
  merchantId: scope.merchantId,
  expectedBusinessId: scope.expectedBusinessId,
  allowlistedMerchantIds: [scope.merchantId],
  allowlistedCustomerIds: [scope.customerId],
  expectedProjectId: 'synthetic',
  actualProjectId: 'synthetic',
};
function fixture() {
  const supabase = { auth: { getUser: vi.fn() } } as unknown as SupabaseClient;
  const options = {
    authenticate: vi.fn(async () => supabase as SupabaseClient | null),
    checkCsrfProtection: vi.fn(async () => ({ valid: true })),
    configuration,
    termsDocument,
    execute: vi
      .fn<
        (
          statement: string,
          parameters: readonly unknown[]
        ) => Promise<{ rows: unknown[] }>
      >()
      .mockResolvedValue({ rows: [{ result: stored }] }),
  };
  return { ...options, handler: createPiggyvestCustomerPolicyHandler(options) };
}
function get(query = `goalId=${scope.goalId}`) {
  return new NextRequest(`https://synthetic.invalid/policy?${query}`);
}
function post(input: unknown = body) {
  return new NextRequest('https://synthetic.invalid/policy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
async function payload(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return response.json();
}
beforeEach(() => {
  vi.mocked(resolvePiggyvestCustomerPolicyContext)
    .mockReset()
    .mockResolvedValue({ status: 'ready', configuration: scope, actorId });
});
describe('draft customer policy handler', () => {
  it('does not bypass final locked validation for a previously accepted receipt', async () => {
    const test = fixture();
    test.execute
      .mockResolvedValueOnce({
        rows: [
          {
            result: { ...stored, actorId, acceptedAt: '2026-09-12T00:00:00Z' },
          },
        ],
      })
      .mockRejectedValueOnce(new Error('binding changed under lock'));
    await payload(await test.handler.POST(post()), 503);
    expect(test.execute).toHaveBeenCalledTimes(2);
  });
  it('rejects an already aborted body without persistence', async () => {
    const test = fixture();
    const request = post();
    const controller = new AbortController();
    controller.abort();
    Object.defineProperty(request, 'signal', { value: controller.signal });
    await payload(await test.handler.POST(request), 400);
    expect(test.execute).not.toHaveBeenCalled();
  });
  it.each([
    'abort',
    'deadline',
  ])('cancels and releases a stalled body on %s', async (interruption) => {
    vi.useFakeTimers();
    try {
      const test = fixture();
      const controller = new AbortController();
      const cancel = vi.fn();
      const stream = new ReadableStream<Uint8Array>({ cancel });
      const request = post();
      Object.defineProperty(request, 'body', { value: stream });
      Object.defineProperty(request, 'signal', { value: controller.signal });
      const pending = test.handler.POST(request);
      await vi.advanceTimersByTimeAsync(0);
      if (interruption === 'abort') controller.abort();
      else await vi.advanceTimersByTimeAsync(2000);
      await payload(await pending, 400);
      expect(cancel).toHaveBeenCalledOnce();
      expect(stream.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      expect(test.execute).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    { 'content-length': '-1' },
    { 'content-length': 'abc' },
    { 'content-length': '1.5' },
    { 'content-encoding': 'gzip' },
    { 'content-length': '1' },
    { 'content-type': 'application/json; charset=latin1' },
  ])('rejects unsupported transport headers', async (headers) => {
    const test = fixture();
    const request = post();
    for (const [name, value] of Object.entries(headers))
      request.headers.set(name, value);
    await payload(await test.handler.POST(request), 400);
    expect(test.execute).not.toHaveBeenCalled();
  });
  it.each([
    'local_test',
    'tls',
  ])('binds the concrete authenticated context and permits only local_test (%s)', async (transport) => {
    const actual = await vi.importActual<
      typeof import('./customer-policy-context')
    >('./customer-policy-context');
    vi.mocked(resolvePiggyvestCustomerPolicyContext).mockImplementation(
      actual.resolvePiggyvestCustomerPolicyContext
    );
    const test = fixture();
    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: scope.merchantId }, error: null })
      .mockResolvedValueOnce({
        data: {
          id: scope.customerId,
          merchant_id: scope.merchantId,
          user_id: actorId,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: scope.goalId,
          merchant_id: scope.merchantId,
          customer_id: scope.customerId,
        },
        error: null,
      });
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const getUser = vi
      .fn()
      .mockResolvedValue({ data: { user: { id: actorId } }, error: null });
    const from = vi.fn().mockReturnValue(query);
    test.authenticate.mockResolvedValue({
      auth: { getUser },
      from,
    } as unknown as SupabaseClient);
    const handler = createPiggyvestCustomerPolicyHandler({
      ...test,
      configuration: { ...configuration, transport },
    });
    await payload(
      await handler.GET(get()),
      transport === 'local_test' ? 200 : 403
    );
    expect(getUser).toHaveBeenCalledOnce();
    if (transport === 'tls') {
      expect(from).not.toHaveBeenCalled();
      expect(test.execute).not.toHaveBeenCalled();
    } else {
      expect(test.authenticate.mock.invocationCallOrder[0]).toBeLessThan(
        getUser.mock.invocationCallOrder[0]
      );
      expect(getUser.mock.invocationCallOrder[0]).toBeLessThan(
        from.mock.invocationCallOrder[0]
      );
      expect(test.execute).toHaveBeenCalledOnce();
    }
  });
  it('reads only public draft review fields after authentication and scoped context', async () => {
    const test = fixture();
    expect(await payload(await test.handler.GET(get()), 200)).toEqual({
      status: 'draft',
      goalId: scope.goalId,
      revisionId: command.revisionId,
      device: {
        productName: 'Synthetic phone',
        variant: null,
        condition: 'new',
      },
      terms: termsDocument,
      consent: 'required',
    });
    expect(test.authenticate.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(resolvePiggyvestCustomerPolicyContext).mock
        .invocationCallOrder[0]
    );
    expect(test.execute).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('piggyvest_goal_policy.read'),
      Object.values(scope).slice(1)
    );
  });
  it('authenticates before configuration, body, CSRF or persistence', async () => {
    const test = fixture();
    test.authenticate.mockResolvedValue(null);
    const options = {
      ...test,
      get configuration(): unknown {
        throw new Error('configuration read before auth');
      },
    };
    const handler = createPiggyvestCustomerPolicyHandler(options);
    expect(await payload(await handler.POST(post()), 401)).toEqual({
      error: 'Policy unavailable',
    });
    expect(test.checkCsrfProtection).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });
  it('rejects CSRF without trusting checker error bodies', async () => {
    const test = fixture();
    test.checkCsrfProtection.mockResolvedValue({ valid: false });
    expect(await payload(await test.handler.POST(post()), 403)).toEqual({
      error: 'Policy unavailable',
    });
    expect(resolvePiggyvestCustomerPolicyContext).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });
  it.each([
    { actorId },
    { customerId: scope.customerId },
    { accepted: false },
    { accepted: undefined },
    { termsHash: 'bad' },
  ])('rejects injected or malformed POST before storage', async (override) => {
    const test = fixture();
    await payload(await test.handler.POST(post({ ...body, ...override })), 400);
    expect(test.execute).not.toHaveBeenCalled();
  });
  it.each([
    `goalId=${scope.goalId}&goalId=${scope.goalId}`,
    `goalId=${scope.goalId}&customerId=${scope.customerId}`,
    '',
  ])('rejects invalid GET queries', async (query) => {
    const test = fixture();
    await payload(await test.handler.GET(get(query)), 400);
    expect(test.execute).not.toHaveBeenCalled();
  });
  it('bounds body bytes even without a content-length header', async () => {
    const test = fixture();
    await payload(
      await test.handler.POST(post({ ...body, padding: 'x'.repeat(5000) })),
      400
    );
    expect(test.execute).not.toHaveBeenCalled();
  });
  it('rejects unavailable authenticated RLS context', async () => {
    const test = fixture();
    vi.mocked(resolvePiggyvestCustomerPolicyContext).mockResolvedValue({
      status: 'unavailable',
    });
    await payload(await test.handler.GET(get()), 403);
    expect(test.execute).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { ...termsDocument, text: 'changed text' },
    { ...termsDocument, version: 'stale-v2' },
    { ...termsDocument, hash: 'b'.repeat(64) },
  ])('fails closed on missing, stale or hash-inconsistent configured document', async (document) => {
    const test = fixture();
    const handler = createPiggyvestCustomerPolicyHandler({
      ...test,
      termsDocument: document,
    });
    await payload(await handler.GET(get()), 409);
    await payload(await handler.POST(post()), 409);
    expect(
      test.execute.mock.calls.every(([statement]) =>
        statement.includes('.read')
      )
    ).toBe(true);
  });
  it.each([
    null,
    { ...stored, device: {} },
    { ...stored, command: { ...command, lifecycle: 'active' } },
    { ...stored, command: { ...command, collectionPaused: false } },
  ])('does not display or accept a missing or non-draft snapshot', async (snapshot) => {
    const test = fixture();
    test.execute.mockResolvedValue({ rows: [{ result: snapshot }] });
    const response = await test.handler.POST(post());
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(test.execute).toHaveBeenCalledOnce();
  });
  it.each([
    { termsVersion: 'stale' },
    { termsHash: 'b'.repeat(64) },
    { revisionId: scope.goalId },
  ])('rejects stale client consent without write', async (override) => {
    const test = fixture();
    await payload(await test.handler.POST(post({ ...body, ...override })), 409);
    expect(test.execute).toHaveBeenCalledOnce();
  });
  it('accepts the staged revision using only derived actor and supports same-actor replay', async () => {
    const test = fixture();
    test.execute
      .mockResolvedValueOnce({ rows: [{ result: stored }] })
      .mockResolvedValueOnce({
        rows: [
          { result: { revisionId: command.revisionId, outcome: 'accepted' } },
        ],
      });
    expect(await payload(await test.handler.POST(post()), 200)).toMatchObject({
      status: 'draft',
      consent: 'accepted',
    });
    expect(test.execute).toHaveBeenLastCalledWith(
      expect.stringContaining('.accept'),
      [
        scope.integrationId,
        scope.merchantId,
        scope.customerId,
        scope.goalId,
        scope.expectedBusinessId,
        command.revisionId,
        actorId,
      ]
    );
    test.execute
      .mockResolvedValueOnce({
        rows: [
          {
            result: { ...stored, actorId, acceptedAt: '2026-09-12T00:00:00Z' },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { result: { revisionId: command.revisionId, outcome: 'accepted' } },
        ],
      });
    expect(await payload(await test.handler.POST(post()), 200)).toMatchObject({
      status: 'draft',
      consent: 'accepted',
    });
    expect(test.execute).toHaveBeenCalledTimes(4);
  });
  it('rejects a receipt belonging to another actor', async () => {
    const test = fixture();
    test.execute.mockResolvedValue({
      rows: [
        {
          result: {
            ...stored,
            actorId: scope.customerId,
            acceptedAt: '2026-09-12T00:00:00Z',
          },
        },
      ],
    });
    await payload(await test.handler.POST(post()), 409);
    expect(test.execute).toHaveBeenCalledOnce();
  });
  it('redacts uncertain acceptance failure without retries', async () => {
    const test = fixture();
    test.execute
      .mockResolvedValueOnce({ rows: [{ result: stored }] })
      .mockRejectedValueOnce(new Error('private error'));
    expect(await payload(await test.handler.POST(post()), 503)).toEqual({
      error: 'Policy unavailable',
    });
    expect(test.execute).toHaveBeenCalledTimes(2);
  });
});
