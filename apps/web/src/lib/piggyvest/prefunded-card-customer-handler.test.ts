import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { createFundingScreenFixture } from './customer-funding-screen.test-fixture';
import type { resolvePiggyvestCustomerPolicyContext } from './customer-policy-context';
import { createPrefundedCardCustomerHandler } from './prefunded-card-customer-handler';

vi.mock('server-only', () => ({}));

function fixture(
  resolveContext?: typeof resolvePiggyvestCustomerPolicyContext
) {
  const source = createFundingScreenFixture();
  const input = {
    goalId: source.identity.goalId,
    savedMethodId: '50000000-0000-4000-8000-000000000001',
    idempotencyKey: '60000000-0000-4000-8000-000000000001',
    amountKobo: 10000,
    consent: { version: 'prefunded-card-v1', oneTimeCharge: true },
  };
  const result = {
    operationId: input.idempotencyKey,
    goalId: input.goalId,
    amountKobo: input.amountKobo,
    currency: 'NGN',
    status: 'pending',
  };
  const execute = vi.fn().mockResolvedValue({ rows: [{ result }] });
  const csrf = vi.fn().mockResolvedValue({ valid: true });
  const handler = createPrefundedCardCustomerHandler({
    ...source.options,
    checkCsrfProtection: csrf,
    resolveContext,
    card: { enabled: true, expectedSystemId: '123', execute },
  });
  const request = (body: unknown = input) =>
    new NextRequest('http://localhost/card-contributions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { source, input, result, execute, csrf, handler, request };
}

describe('authenticated prefunded contribution intake', () => {
  it('queues rather than charges and returns only the customer-safe persisted result', async () => {
    const { handler, request, execute, result, input, source } = fixture();
    const response = await handler.POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(result);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][1].slice(0, 7)).toEqual([
      source.identity.integrationId,
      source.identity.merchantId,
      source.identity.customerId,
      input.goalId,
      source.rows.customers && (await source.getUser()).data.user.id,
      'synthetic-business',
      '123',
    ]);
    expect(JSON.parse(execute.mock.calls[0][1][7])).toEqual(input);
  });
  it('authenticates before CSRF and database access', async () => {
    const { handler, request, execute, csrf, source } = fixture();
    source.getUser.mockRejectedValue(new Error('expired'));
    expect((await handler.POST(request())).status).toBe(401);
    expect(csrf).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
  it('refuses missing CSRF without reserving a contribution', async () => {
    const { handler, request, execute, csrf } = fixture();
    csrf.mockResolvedValue({ valid: false });
    expect((await handler.POST(request())).status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([
    'customerId',
    'authorizationCode',
    'destinationWalletId',
  ])('rejects extra authority %s', async (key) => {
    const { handler, request, execute, input } = fixture();
    expect(
      (await handler.POST(request({ ...input, [key]: 'spoofed' }))).status
    ).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
  it('refuses a different goal even when authenticated', async () => {
    const { handler, request, execute, input } = fixture();
    expect(
      (await handler.POST(request({ ...input, goalId: input.savedMethodId })))
        .status
    ).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
  it('does not leak a changed actor or database error after an uncertain write', async () => {
    const { handler, request, execute } = fixture();
    execute.mockRejectedValue(new Error('private credential'));
    const response = await handler.POST(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      'private credential'
    );
  });
  it('reads status with the same idempotency key without taking another payment', async () => {
    const { handler, execute, input } = fixture();
    const response = await handler.GET(
      new NextRequest(
        `http://localhost/card-contributions?goalId=${input.goalId}&idempotencyKey=${input.idempotencyKey}`
      )
    );
    expect(response.status).toBe(200);
    expect(execute.mock.calls[0][0]).toContain('customer_status(');
  });

  it.each([
    undefined,
    null,
    {},
    { version: 'prefunded-card-v1', oneTimeCharge: false },
    { version: 'prefunded-card-v1', oneTimeCharge: 'true' },
    { version: 'another-version', oneTimeCharge: true },
    { version: 'prefunded-card-v1', oneTimeCharge: true, recurring: true },
  ])('refuses missing or invalid explicit consent before reservation', async (consent) => {
    const { handler, request, execute, input } = fixture();
    expect((await handler.POST(request({ ...input, consent }))).status).toBe(
      400
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('reads goal-only capability without CSRF, charging, or first-card checkout', async () => {
    const { handler, execute, csrf, input } = fixture();
    const capability = {
      goalId: input.goalId,
      enabled: true,
      newCardEnabled: false,
      currency: 'NGN',
      maximumAmountKobo: 25000,
      savedMethods: [{ id: input.savedMethodId, brand: 'visa', last4: '4081' }],
    };
    execute.mockResolvedValue({ rows: [{ result: capability }] });
    const response = await handler.GET(
      new NextRequest(
        `http://localhost/card-contributions?goalId=${input.goalId}`
      )
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(capability);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toContain('customer_capabilities(');
    expect(execute.mock.calls[0][1]).toHaveLength(8);
    expect(JSON.parse(execute.mock.calls[0][1][7])).toEqual({
      goalId: input.goalId,
    });
    expect(csrf).not.toHaveBeenCalled();
  });

  it('returns a disabled saved-card capability without inventing first-card checkout', async () => {
    const { handler, execute, input } = fixture();
    const capability = {
      goalId: input.goalId,
      enabled: false,
      newCardEnabled: false,
      currency: 'NGN',
      maximumAmountKobo: 0,
      savedMethods: [],
    };
    execute.mockResolvedValue({ rows: [{ result: capability }] });
    const response = await handler.GET(
      new NextRequest(
        `http://localhost/card-contributions?goalId=${input.goalId}`
      )
    );
    expect(await response.json()).toEqual(capability);
  });

  it.each([
    { goalId: '90000000-0000-4000-8000-000000000099' },
    { newCardEnabled: true },
    { maximumAmountKobo: -1 },
    { authorizationCode: 'private-secret' },
    { availableFloatKobo: 10000 },
    {
      savedMethods: [{ id: 'invalid', brand: 'visa', last4: 'private-secret' }],
    },
  ])('refuses malformed or secret-bearing capability results', async (change) => {
    const { handler, execute, input } = fixture();
    execute.mockResolvedValue({
      rows: [
        {
          result: {
            goalId: input.goalId,
            enabled: false,
            newCardEnabled: false,
            currency: 'NGN',
            maximumAmountKobo: 0,
            savedMethods: [],
            ...change,
          },
        },
      ],
    });
    const response = await handler.GET(
      new NextRequest(
        `http://localhost/card-contributions?goalId=${input.goalId}`
      )
    );
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      'private-secret'
    );
  });

  it('uses only the server-injected context resolver and rechecks it after SQL', async () => {
    const resolveContext =
      vi.fn<typeof resolvePiggyvestCustomerPolicyContext>();
    const { handler, execute, input, source } = fixture(resolveContext);
    const actorId = (await source.getUser()).data.user.id;
    resolveContext.mockResolvedValue({
      status: 'ready',
      actorId,
      configuration: {
        environment: 'staging',
        integrationId: source.identity.integrationId,
        merchantId: source.identity.merchantId,
        customerId: source.identity.customerId,
        goalId: input.goalId,
        expectedBusinessId: 'synthetic-business',
      },
    });
    execute.mockResolvedValue({
      rows: [
        {
          result: {
            goalId: input.goalId,
            enabled: false,
            newCardEnabled: false,
            currency: 'NGN',
            maximumAmountKobo: 0,
            savedMethods: [],
          },
        },
      ],
    });
    expect(
      (
        await handler.GET(
          new NextRequest(
            `http://localhost/card-contributions?goalId=${input.goalId}`
          )
        )
      ).status
    ).toBe(200);
    expect(resolveContext).toHaveBeenCalledTimes(2);
    expect(source.from).not.toHaveBeenCalled();
    resolveContext.mockResolvedValueOnce({ status: 'unavailable' });
    execute.mockClear();
    expect(
      (
        await handler.GET(
          new NextRequest(
            `http://localhost/card-contributions?goalId=${input.goalId}`
          )
        )
      ).status
    ).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects duplicate and unexpected capability selectors before SQL', async () => {
    const { handler, input, execute } = fixture();
    for (const suffix of [
      `&goalId=${input.goalId}`,
      '&resolveContext=spoofed',
      '&idempotencyKey=',
    ])
      expect(
        (
          await handler.GET(
            new NextRequest(
              `http://localhost/card-contributions?goalId=${input.goalId}${suffix}`
            )
          )
        ).status
      ).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
