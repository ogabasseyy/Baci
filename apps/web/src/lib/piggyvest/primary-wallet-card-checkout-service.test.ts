import { describe, expect, it, vi } from 'vitest';
import { primaryWalletCardCheckoutSchemas as schemas } from '@/schemas/primary-wallet-card-checkout';
import { primaryWalletCardCheckoutFixture as fixture } from './primary-wallet-card-checkout.test-fixture';
import { createPrimaryWalletCardCheckoutService } from './primary-wallet-card-checkout-service';

const scope = schemas.scope.parse(
  Object.fromEntries(
    Object.entries(fixture.intent).filter(([key]) => key in schemas.scope.shape)
  )
);
const request = {
  merchantId: fixture.settings.merchantId,
  idempotencyKey: fixture.intent.operationId,
  amountKobo: 25000,
  consent: fixture.intent.consent,
};

function setup() {
  let intent = schemas.intent.parse(fixture.intent);
  const execute = vi.fn(
    async (
      action: string,
      parameters: readonly (string | null)[]
    ): Promise<unknown> => {
      if (action === 'reserve' || action === 'read') return intent;
      if (action === 'claim') {
        if (intent.status !== 'reserved')
          return { outcome: 'existing', intent };
        intent = { ...intent, status: 'initializing' };
        return {
          outcome: 'claimed',
          token: fixture.intent.operationId,
          intent,
        };
      }
      if (action === 'initialize') {
        const session = parameters[3]
          ? schemas.session.parse(JSON.parse(parameters[3]))
          : null;
        intent = {
          ...intent,
          status: session ? 'ready' : 'init_unknown',
          authorizationUrl: session?.authorizationUrl ?? null,
        };
        return true;
      }
      if (action === 'collection') {
        intent = { ...intent, status: 'custody_pending' };
        return true;
      }
      if (action === 'reconciliation') {
        intent = { ...intent, status: 'reconciliation_required' };
        return true;
      }
      throw new Error('Invalid test action');
    }
  );
  const provider = {
    initialize: vi.fn().mockResolvedValue({
      reference: fixture.intent.reference,
      authorizationUrl: 'https://checkout.paystack.com/fixture123',
    }),
    verify: vi.fn().mockResolvedValue({
      outcome: 'verified',
      collection: {
        reference: fixture.intent.reference,
        amountKobo: 25000,
        domain: 'test',
        providerTransactionId: '12345',
        token: null,
      },
    }),
  };
  const service = createPrimaryWalletCardCheckoutService({
    settings: fixture.settings,
    scope,
    execute,
    provider,
  });
  return { execute, provider, service };
}

describe('durable goal-independent card checkout service', () => {
  it('initializes once and resumes the same stored checkout on retry', async () => {
    const { service, provider } = setup();
    const first = await service.initialize(request);
    expect(first.status).toBe('ready');
    expect(await service.initialize(request)).toEqual(first);
    expect(provider.initialize).toHaveBeenCalledTimes(1);
  });
  it('never reinitializes after an ambiguous provider result', async () => {
    const { service, provider } = setup();
    provider.initialize.mockRejectedValue(new Error('private provider error'));
    expect((await service.initialize(request)).status).toBe('init_unknown');
    expect((await service.initialize(request)).status).toBe('init_unknown');
    expect(provider.initialize).toHaveBeenCalledTimes(1);
  });
  it('records collection without a reusable card and stops at custody_pending', async () => {
    const { service, provider, execute } = setup();
    await service.initialize(request);
    const result = await service.status(fixture.intent.operationId);
    expect(result.status).toBe('custody_pending');
    expect(result).not.toHaveProperty('authorizationUrl');
    expect(JSON.stringify(result)).not.toContain('token');
    expect(execute.mock.calls.some(([action]) => action === 'collection')).toBe(
      true
    );
    expect((await service.status(fixture.intent.operationId)).status).toBe(
      'custody_pending'
    );
    expect(provider.verify).toHaveBeenCalledTimes(1);
  });
  it('requires durable evidence storage before reporting custody_pending', async () => {
    const { service, execute } = setup();
    await service.initialize(request);
    execute.mockImplementationOnce(async () =>
      schemas.intent.parse({ ...fixture.intent, status: 'ready' })
    );
    execute.mockImplementationOnce(async () => false);
    await expect(service.status(fixture.intent.operationId)).rejects.toThrow();
  });
  it('persists reconciliation on invalid collection evidence', async () => {
    const { service, provider } = setup();
    await service.initialize(request);
    provider.verify.mockResolvedValue({ outcome: 'reconciliation_required' });
    expect((await service.status(fixture.intent.operationId)).status).toBe(
      'reconciliation_required'
    );
  });
  it('rejects a foreign scope returned by storage before provider initialization', async () => {
    const { service, execute, provider } = setup();
    execute.mockResolvedValueOnce({
      ...fixture.intent,
      customerId: '10000000-0000-4000-8000-000000000009',
    });
    await expect(service.initialize(request)).rejects.toThrow();
    expect(provider.initialize).not.toHaveBeenCalled();
  });
  it('does not verify a different operation returned by read', async () => {
    const { service, execute, provider } = setup();
    execute.mockResolvedValueOnce(fixture.intent);
    await expect(
      service.status('10000000-0000-4000-8000-000000000009')
    ).rejects.toThrow();
    expect(provider.verify).not.toHaveBeenCalled();
  });
  it('rejects an expired config before storage', async () => {
    const { execute, provider } = setup();
    const service = createPrimaryWalletCardCheckoutService({
      settings: { ...fixture.settings, expiresAt: '2026-09-29T15:59:10Z' },
      scope,
      execute,
      provider,
    });
    await expect(service.initialize(request)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
