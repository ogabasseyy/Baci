import { describe, expect, it, vi } from 'vitest';
import { primaryWalletCardCheckoutSchemas as schemas } from '@/schemas/primary-wallet-card-checkout';
import { primaryWalletCardCheckoutFixture as fixture } from './primary-wallet-card-checkout.test-fixture';
import { createPrimaryWalletCardCheckoutService } from './primary-wallet-card-checkout-service';

const scope = schemas.scope.parse(
  Object.fromEntries(
    Object.entries(fixture.intent).filter(([key]) => key in schemas.scope.shape)
  )
);
const collection = {
  reference: fixture.intent.reference,
  amountKobo: fixture.intent.amountKobo,
  domain: 'test',
  providerTransactionId: '12345',
  token: null,
};
// Storage actions that belong to the retired initialization path. The
// fake storage below refuses them, so any call fails the test.
const RETIRED_ACTIONS = ['reserve', 'claim', 'initialize'];

type Status = ReturnType<typeof schemas.intent.parse>['status'];

function setup(status: Status, settings: unknown = fixture.settings) {
  let intent = schemas.intent.parse({
    ...fixture.intent,
    status,
    authorizationUrl:
      status === 'ready' ? 'https://checkout.paystack.com/fixture123' : null,
  });
  const execute = vi.fn(
    async (
      action: string,
      _parameters: readonly (string | null)[]
    ): Promise<unknown> => {
      if (action === 'read') return intent;
      if (action === 'collection') {
        intent = { ...intent, status: 'custody_pending' };
        return true;
      }
      if (action === 'reconciliation') {
        intent = { ...intent, status: 'reconciliation_required' };
        return true;
      }
      if (action === 'abandonment') {
        intent = { ...intent, status: 'abandoned' };
        return true;
      }
      throw new Error(`Retired or unknown storage action: ${action}`);
    }
  );
  const provider = {
    // Sentinel: hosted checkout creation must never run again.
    initialize: vi.fn(),
    verify: vi.fn().mockResolvedValue({ outcome: 'verified', collection }),
  };
  const service = createPrimaryWalletCardCheckoutService({
    settings,
    scope,
    execute,
    provider,
  });
  const actions = () => execute.mock.calls.map(([action]) => action);
  return { execute, provider, service, actions };
}

function expectNoInitialization(test: ReturnType<typeof setup>) {
  expect(test.actions().filter((a) => RETIRED_ACTIONS.includes(a))).toEqual([]);
  expect(test.provider.initialize).not.toHaveBeenCalled();
}

describe('card checkout service after initialization retirement', () => {
  it('exposes status as its only entry point', () => {
    expect(Object.keys(setup('ready').service)).toEqual(['status']);
  });
  it('records collection without a reusable card and stops at custody_pending', async () => {
    const test = setup('ready');
    const result = await test.service.status(fixture.intent.operationId);
    expect(result.status).toBe('custody_pending');
    expect(result).not.toHaveProperty('authorizationUrl');
    expect(JSON.stringify(result)).not.toContain('token');
    expect(test.actions()).toContain('collection');
    expect((await test.service.status(fixture.intent.operationId)).status).toBe(
      'custody_pending'
    );
    expect(test.provider.verify).toHaveBeenCalledTimes(1);
    expectNoInitialization(test);
  });
  it('requires durable evidence storage before reporting custody_pending', async () => {
    const test = setup('ready');
    test.execute.mockImplementationOnce(async () =>
      schemas.intent.parse({ ...fixture.intent, status: 'ready' })
    );
    test.execute.mockImplementationOnce(async () => false);
    await expect(
      test.service.status(fixture.intent.operationId)
    ).rejects.toThrow();
  });
  it('persists reconciliation on invalid collection evidence', async () => {
    const test = setup('ready');
    test.provider.verify.mockResolvedValue({
      outcome: 'reconciliation_required',
    });
    expect((await test.service.status(fixture.intent.operationId)).status).toBe(
      'reconciliation_required'
    );
  });
  it('terminalizes an abandoned checkout and stops verifying it', async () => {
    const test = setup('ready');
    test.provider.verify.mockResolvedValue({ outcome: 'abandoned' });
    expect((await test.service.status(fixture.intent.operationId)).status).toBe(
      'abandoned'
    );
    expect(test.actions()).toContain('abandonment');
    expect((await test.service.status(fixture.intent.operationId)).status).toBe(
      'abandoned'
    );
    expect(test.provider.verify).toHaveBeenCalledTimes(1);
  });
  it.each([
    'initializing',
    'init_unknown',
  ] as const)('drains a %s operation by provider verification only', async (status) => {
    const test = setup(status);
    const result = await test.service.status(fixture.intent.operationId);
    expect(result.status).toBe('custody_pending');
    expect(test.provider.verify).toHaveBeenCalledTimes(1);
    expectNoInitialization(test);
  });
  it.each([
    'initializing',
    'init_unknown',
  ] as const)('keeps a %s operation pending while the provider is undecided', async (status) => {
    const test = setup(status);
    test.provider.verify.mockResolvedValue({ outcome: 'pending' });
    expect((await test.service.status(fixture.intent.operationId)).status).toBe(
      status
    );
    expectNoInitialization(test);
  });
  it.each([
    'reserved',
    'custody_pending',
    'reconciliation_required',
    'completed',
    'abandoned',
  ] as const)('returns a stored %s operation without provider work', async (status) => {
    const test = setup(status);
    expect((await test.service.status(fixture.intent.operationId)).status).toBe(
      status
    );
    expect(test.provider.verify).not.toHaveBeenCalled();
    expect(test.actions()).toEqual(['read']);
  });
  it('authorizes status by immutable IDs across a profile email change', async () => {
    const test = setup('custody_pending');
    test.execute.mockImplementationOnce(async () => ({
      ...fixture.intent,
      email: 'changed@example.test',
      status: 'custody_pending',
    }));
    expect((await test.service.status(fixture.intent.operationId)).status).toBe(
      'custody_pending'
    );
  });
  it('rejects a foreign scope returned by storage before provider verification', async () => {
    const test = setup('ready');
    test.execute.mockResolvedValueOnce({
      ...fixture.intent,
      customerId: '10000000-0000-4000-8000-000000000009',
    });
    await expect(
      test.service.status(fixture.intent.operationId)
    ).rejects.toThrow();
    expect(test.provider.verify).not.toHaveBeenCalled();
  });
  it('does not verify a different operation returned by read', async () => {
    const test = setup('ready');
    await expect(
      test.service.status('10000000-0000-4000-8000-000000000009')
    ).rejects.toThrow();
    expect(test.provider.verify).not.toHaveBeenCalled();
  });
  it('drains status past expiry so pre-expiry payments still settle', async () => {
    const test = setup('ready', {
      ...fixture.settings,
      expiresAt: '2026-09-29T15:59:10Z',
    });
    const result = await test.service.status(fixture.intent.operationId);
    expect(result.status).toBe('custody_pending');
    expect(test.actions()).toContain('collection');
  });
  it('rejects a scope bound to a different integration at construction', () => {
    expect(() =>
      createPrimaryWalletCardCheckoutService({
        settings: fixture.settings,
        scope: {
          ...scope,
          integrationId: '10000000-0000-4000-8000-000000000009',
        },
        execute: vi.fn(),
        provider: { verify: vi.fn() },
      })
    ).toThrow('Primary card scope unavailable');
  });
});
