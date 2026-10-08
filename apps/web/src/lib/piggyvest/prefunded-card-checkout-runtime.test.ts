import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prefundedCardCheckoutStateSchemas as states } from '@/schemas/prefunded-card-checkout-state';
import { prefundedCardCheckoutRuntimeFixture } from './prefunded-card-checkout-runtime.test-fixture';

vi.mock('server-only', () => ({}));

const { fixture, reserved, ready } = prefundedCardCheckoutRuntimeFixture();
let timestamp: number;

function setup() {
  return prefundedCardCheckoutRuntimeFixture(() => timestamp);
}

beforeEach(() => {
  timestamp = Date.parse('2026-09-26T12:00:00Z');
});

describe('first-card checkout initialization', () => {
  it('reserves and claims before initialization and exposes only the recorded URL', async () => {
    const { store, provider, resolveCustomer, runtime } = setup();
    const result = await runtime.start(fixture.customerRequest);
    expect(store.reserve).toHaveBeenCalledWith(fixture.scope, fixture.request);
    expect(resolveCustomer).toHaveBeenCalledWith(fixture.intent.goalId);
    expect(store.claimInitialization).toHaveBeenCalledWith(
      fixture.scope,
      fixture.selection
    );
    expect(provider.initialize).toHaveBeenCalledWith(fixture.intent);
    expect(store.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      provider.initialize.mock.invocationCallOrder[0]
    );
    expect(store.claimInitialization.mock.invocationCallOrder[0]).toBeLessThan(
      provider.initialize.mock.invocationCallOrder[0]
    );
    expect(store.completeInitialization).toHaveBeenCalledWith(
      fixture.scope,
      fixture.selection,
      fixture.claim,
      fixture.session
    );
    expect(result).toEqual({
      intentId: fixture.intent.intentId,
      goalId: fixture.intent.goalId,
      amountKobo: 10000,
      currency: 'NGN',
      status: 'ready',
      authorizationUrl: fixture.session.authorizationUrl,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /email|actorId|treasury|Fingerprint|authorizationCode/
    );
  });

  it('never calls the provider when reservation fails or returned identity drifts', async () => {
    const { store, provider, runtime } = setup();
    store.reserve.mockRejectedValueOnce(new Error('private-db-secret'));
    await expect(runtime.start(fixture.customerRequest)).rejects.toThrow(
      'First-card checkout unavailable'
    );
    store.reserve.mockResolvedValueOnce({
      ...reserved,
      intent: { ...fixture.intent, customerId: fixture.intent.actorId },
    });
    await expect(runtime.start(fixture.customerRequest)).rejects.toThrow(
      'First-card checkout unavailable'
    );
    store.reserve.mockResolvedValueOnce({
      ...reserved,
      intent: { ...fixture.intent, amountKobo: 20000 },
    });
    await expect(runtime.start(fixture.customerRequest)).rejects.toThrow(
      'First-card checkout unavailable'
    );
    expect(provider.initialize).not.toHaveBeenCalled();
  });

  it('does not call storage for unconsented input or accept a replacement claim', async () => {
    const { store, provider, runtime } = setup();
    await expect(
      runtime.start({ ...fixture.customerRequest, consent: undefined })
    ).rejects.toThrow('First-card checkout unavailable');
    expect(store.reserve).not.toHaveBeenCalled();
    store.claimInitialization.mockResolvedValueOnce({
      ...fixture.claim,
      intent: {
        ...fixture.intent,
        email: 'changed@example.test',
      },
    });
    await expect(runtime.start(fixture.customerRequest)).rejects.toThrow(
      'First-card checkout unavailable'
    );
    expect(provider.initialize).not.toHaveBeenCalled();
  });

  it('rejects forged customer identity, resolver failures, and mismatched goal identity before reserve or provider calls', async () => {
    const { store, provider, resolveCustomer, runtime } = setup();
    await expect(
      runtime.start({
        ...fixture.customerRequest,
        actorId: fixture.intent.actorId,
        customerId: fixture.intent.customerId,
      })
    ).rejects.toThrow('First-card checkout unavailable');
    expect(resolveCustomer).not.toHaveBeenCalled();
    expect(store.reserve).not.toHaveBeenCalled();

    resolveCustomer.mockRejectedValueOnce(new Error('private-resolver-detail'));
    await expect(runtime.start(fixture.customerRequest)).rejects.toThrow(
      'First-card checkout unavailable'
    );
    expect(store.reserve).not.toHaveBeenCalled();
    expect(provider.initialize).not.toHaveBeenCalled();
    expect(provider.verify).not.toHaveBeenCalled();

    resolveCustomer.mockResolvedValueOnce({
      ...fixture.customerIdentity,
      goalId: '00000000-0000-4000-8000-000000000010',
    });
    await expect(runtime.start(fixture.customerRequest)).rejects.toThrow(
      'First-card checkout unavailable'
    );
    expect(store.reserve).not.toHaveBeenCalled();
    expect(provider.initialize).not.toHaveBeenCalled();
  });

  it('returns the existing checkout without initializing another transaction', async () => {
    const { store, provider, runtime } = setup();
    store.reserve.mockResolvedValue(ready);
    expect(
      (await runtime.start(fixture.customerRequest)).authorizationUrl
    ).toBe(fixture.session.authorizationUrl);
    expect(provider.initialize).not.toHaveBeenCalled();
    expect(store.claimInitialization).not.toHaveBeenCalled();
  });

  it('only initializes once when the durable store gives one winner to competing starts', async () => {
    const { store, provider, runtime } = setup();
    let claimed = false;
    store.claimInitialization.mockImplementation(async () => {
      if (claimed)
        return {
          outcome: 'existing',
          snapshot: { ...reserved, phase: 'initializing' },
        };
      claimed = true;
      return fixture.claim;
    });
    await Promise.all([
      runtime.start(fixture.customerRequest),
      runtime.start(fixture.customerRequest),
    ]);
    expect(provider.initialize).toHaveBeenCalledTimes(1);
  });

  it('keeps timeout and failed persistence outcomes uncertain without exposing checkout or resubmitting', async () => {
    const { store, provider, runtime } = setup();
    provider.initialize.mockRejectedValueOnce(new Error('provider-secret'));
    expect(await runtime.start(fixture.customerRequest)).toMatchObject({
      status: 'pending',
    });
    expect(store.markInitializationUncertain).toHaveBeenCalledTimes(1);
    expect(store.completeInitialization).not.toHaveBeenCalled();
    store.reserve.mockResolvedValueOnce({ ...reserved, phase: 'pending' });
    await runtime.start(fixture.customerRequest);
    expect(provider.initialize).toHaveBeenCalledTimes(1);
    store.completeInitialization.mockRejectedValueOnce(
      new Error('storage-secret')
    );
    const uncertain = await runtime.start(fixture.customerRequest);
    expect(uncertain.status).toBe('pending');
    expect(uncertain).not.toHaveProperty('authorizationUrl');
  });

  it('refuses expired claims and honors the deadline after initialization returns', async () => {
    const { store, provider, runtime } = setup();
    store.claimInitialization.mockResolvedValueOnce({
      ...fixture.claim,
      leaseExpiresAt: '2026-09-26T12:00:00Z',
    });
    expect((await runtime.start(fixture.customerRequest)).status).toBe(
      'pending'
    );
    expect(provider.initialize).not.toHaveBeenCalled();
    store.markInitializationUncertain.mockClear();
    provider.initialize.mockImplementationOnce(async () => {
      timestamp = Date.parse(fixture.scope.expiresAt);
      return fixture.session;
    });
    store.markInitializationUncertain.mockImplementationOnce(async () => {
      expect(timestamp).toBe(Date.parse(fixture.scope.expiresAt));
    });
    await expect(runtime.start(fixture.customerRequest)).rejects.toThrow(
      'First-card checkout unavailable'
    );
    expect(store.markInitializationUncertain).toHaveBeenCalledWith(
      fixture.scope,
      fixture.selection,
      fixture.claim
    );
    expect(provider.initialize.mock.invocationCallOrder[0]).toBeLessThan(
      store.markInitializationUncertain.mock.invocationCallOrder[0]
    );
    expect(store.completeInitialization).not.toHaveBeenCalled();
  });

  it('checks the strict durable result even when the store violates its contract', async () => {
    const { store, provider, runtime } = setup();
    const malformed = { ...ready, secret: 'must-not-leak' };
    expect(states.snapshot.safeParse(malformed).success).toBe(false);
    store.reserve.mockResolvedValue(malformed);
    await expect(runtime.start(fixture.customerRequest)).rejects.toThrow(
      'First-card checkout unavailable'
    );
    expect(provider.initialize).not.toHaveBeenCalled();
  });
});

describe('first-card checkout retirement', () => {
  it('returns a retired snapshot without verifying with the payment provider', async () => {
    const { store, provider, runtime } = setup();
    store.read.mockResolvedValue({
      ...ready,
      phase: 'retired_unconfirmed',
      session: null,
      operationId: null,
    });

    await expect(runtime.refresh(fixture.customerSelection)).resolves.toEqual({
      intentId: fixture.intent.intentId,
      goalId: fixture.intent.goalId,
      amountKobo: fixture.intent.amountKobo,
      currency: 'NGN',
      status: 'retired_unconfirmed',
    });
    expect(provider.verify).not.toHaveBeenCalled();
  });
});
