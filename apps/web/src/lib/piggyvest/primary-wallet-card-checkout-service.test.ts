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
  let leaseExpired = false;
  const execute = vi.fn(
    async (
      action: string,
      parameters: readonly (string | null)[]
    ): Promise<unknown> => {
      if (action === 'reserve' || action === 'read') return intent;
      if (action === 'claim') {
        // Mirrors claim_initialization lease semantics: a fresh
        // 'initializing'/'init_unknown' claim is shared, only a stale one
        // is re-issued (resetting to 'initializing' for a fresh recording).
        if (
          !leaseExpired &&
          (intent.status === 'initializing' || intent.status === 'init_unknown')
        )
          return { outcome: 'existing', intent };
        if (
          intent.status !== 'reserved' &&
          intent.status !== 'initializing' &&
          intent.status !== 'init_unknown'
        )
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
      if (action === 'abandonment') {
        intent = { ...intent, status: 'abandoned' };
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
  return {
    execute,
    provider,
    service,
    expireClaimLease: () => {
      leaseExpired = true;
    },
  };
}

describe('durable goal-independent card checkout service', () => {
  it('initializes once and resumes the same stored checkout on retry', async () => {
    const { service, provider } = setup();
    const first = await service.initialize(request);
    expect(first.status).toBe('ready');
    expect(await service.initialize(request)).toEqual(first);
    expect(provider.initialize).toHaveBeenCalledTimes(1);
  });
  it('authorizes recovery by immutable IDs across a profile email change', async () => {
    const { service, execute } = setup();
    const changed = { ...fixture.intent, email: 'changed@example.test' };
    execute.mockImplementationOnce(async () => changed);
    execute.mockImplementationOnce(async () => ({
      outcome: 'existing',
      intent: changed,
    }));
    expect((await service.initialize(request)).status).toBe('reserved');
  });
  it('resumes the recovered unresolved operation after local storage loss', async () => {
    const { service, provider, execute } = setup();
    // Storage lost: same funding retried with a new key; reserve returns
    // the existing ready operation instead of raising.
    const recovered = schemas.intent.parse({
      ...fixture.intent,
      status: 'ready',
      authorizationUrl: 'https://checkout.paystack.com/fixture123',
    });
    execute.mockImplementationOnce(async () => recovered);
    execute.mockImplementationOnce(async () => ({
      outcome: 'existing',
      intent: recovered,
    }));
    const result = await service.initialize(request);
    expect(result.status).toBe('ready');
    expect(result.authorizationUrl).toBe(
      'https://checkout.paystack.com/fixture123'
    );
    expect(provider.initialize).not.toHaveBeenCalled();
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
  it('terminalizes an abandoned checkout and stops verifying it', async () => {
    const { service, provider, execute } = setup();
    await service.initialize(request);
    provider.verify.mockResolvedValue({ outcome: 'abandoned' });
    expect((await service.status(fixture.intent.operationId)).status).toBe(
      'abandoned'
    );
    expect(
      execute.mock.calls.some(([action]) => action === 'abandonment')
    ).toBe(true);
    expect((await service.status(fixture.intent.operationId)).status).toBe(
      'abandoned'
    );
    expect(provider.verify).toHaveBeenCalledTimes(1);
  });
  it('shares a fresh claim and reinitializes only after the lease expires', async () => {
    const { service, provider, execute, expireClaimLease } = setup();
    const inner = execute.getMockImplementation();
    let crashed = false;
    execute.mockImplementation(async (action, parameters) => {
      // First attempt crashes between claim and record: the acknowledgement
      // is lost and the operation stays 'initializing'.
      if (action === 'initialize' && !crashed) {
        crashed = true;
        return true;
      }
      return inner?.(action, parameters);
    });
    expect((await service.initialize(request)).status).toBe('initializing');
    // Overlapping retry within the lease shares the claim instead of
    // replacing the token (Paystack rejects repeated references).
    expect((await service.initialize(request)).status).toBe('initializing');
    expect(provider.initialize).toHaveBeenCalledTimes(1);
    expireClaimLease();
    expect((await service.initialize(request)).status).toBe('ready');
    expect(provider.initialize).toHaveBeenCalledTimes(2);
  });
  it('re-enters initialization from status once a stale claim expires', async () => {
    const { service, provider, expireClaimLease } = setup();
    provider.initialize.mockRejectedValueOnce(
      new Error('private provider error')
    );
    expect((await service.initialize(request)).status).toBe('init_unknown');
    // Fresh lease: status keeps verifying instead of reinitializing.
    provider.verify.mockResolvedValue({ outcome: 'pending' });
    expect((await service.status(fixture.intent.operationId)).status).toBe(
      'init_unknown'
    );
    expect(provider.initialize).toHaveBeenCalledTimes(1);
    expect(provider.verify).toHaveBeenCalledTimes(1);
    expireClaimLease();
    expect((await service.status(fixture.intent.operationId)).status).toBe(
      'ready'
    );
    expect(provider.initialize).toHaveBeenCalledTimes(2);
  });
  it('abandons an orphaned session when re-entry proves a duplicate reference', async () => {
    const { service, provider, expireClaimLease } = setup();
    provider.initialize.mockRejectedValueOnce(
      new Error('private provider error')
    );
    expect((await service.initialize(request)).status).toBe('init_unknown');
    expireClaimLease();
    provider.initialize.mockRejectedValueOnce(
      Object.assign(new Error('Primary card duplicate reference'), {
        code: 'PRIMARY_CARD_DUPLICATE_REFERENCE',
      })
    );
    expect((await service.status(fixture.intent.operationId)).status).toBe(
      'abandoned'
    );
    expect(provider.verify).not.toHaveBeenCalled();
  });
  it('abandons from initialize when a reclaimed retry proves a duplicate reference', async () => {
    const { service, provider, expireClaimLease } = setup();
    provider.initialize.mockRejectedValueOnce(
      new Error('private provider error')
    );
    expect((await service.initialize(request)).status).toBe('init_unknown');
    expireClaimLease();
    provider.initialize.mockRejectedValueOnce(
      Object.assign(new Error('Primary card duplicate reference'), {
        code: 'PRIMARY_CARD_DUPLICATE_REFERENCE',
      })
    );
    expect((await service.initialize(request)).status).toBe('abandoned');
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
  it('rejects below-minimum funding before storage', async () => {
    const { service, execute } = setup();
    await expect(
      service.initialize({ ...request, amountKobo: 4999 })
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it('adopts the stored unresolved checkout when the re-entered amount differs', async () => {
    const { service, provider } = setup();
    const adopted = await service.initialize({
      ...request,
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
      amountKobo: 30000,
    });
    // The stored intent is authoritative: the response carries the stored
    // amount and operation ID so the client persists and resumes it.
    expect(adopted.amountKobo).toBe(25000);
    expect(adopted.operationId).toBe(fixture.intent.operationId);
    expect(adopted.status).toBe('ready');
    expect(provider.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: fixture.intent.operationId,
        amountKobo: 25000,
      })
    );
  });
  it('adopts the stored unresolved checkout when consent differs', async () => {
    const { service } = setup();
    const adopted = await service.initialize({
      ...request,
      amountKobo: 25000,
      consent: { ...request.consent, saveCard: !request.consent.saveCard },
    });
    expect(adopted.amountKobo).toBe(25000);
    expect(adopted.operationId).toBe(fixture.intent.operationId);
  });
});
