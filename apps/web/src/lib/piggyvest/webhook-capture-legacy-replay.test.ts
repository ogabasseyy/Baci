import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  dispose: vi.fn(),
  content: false,
  authorization: false,
  incomplete: false,
  killSwitch: false,
  conflict: false,
  eventType: 'bank-transfer.inflow.success',
}));

vi.mock('server-only', () => ({}));
vi.mock('./server-intake-client', () => ({
  createPiggyvestIntakeClient: () => ({ dispose: mocks.dispose }),
}));
vi.mock('@/app/api/webhooks/piggyvest/process-delivery', () => ({
  processVerifiedDelivery: mocks.process,
  isContentQuarantine: () => mocks.content,
  isAuthorizationQuarantine: () => mocks.authorization,
  isKeySetIncompleteRetry: () => mocks.incomplete,
  isKillSwitchDeferred: () => mocks.killSwitch,
  isConflictQuarantine: () => mocks.conflict,
}));
vi.mock('./webhook-capture-stored-event', () => ({
  parseStoredPiggyvestEvent: () => ({ eventType: mocks.eventType }),
}));

import type { ReplayDelivery } from './webhook-capture-drain';
import { replayLegacyDelivery } from './webhook-capture-legacy-replay';

const delivery = (overrides: Partial<ReplayDelivery> = {}): ReplayDelivery => ({
  rawBody: Buffer.from('exact stored body'),
  signature: 'exact-stored-signature',
  matchedSecret: 'synthetic-key',
  families: ['legacy'],
  recordedFamilies: ['legacy'],
  keyScope: 'replay',
  ...overrides,
});

describe('legacy capture replay adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.content = false;
    mocks.authorization = false;
    mocks.incomplete = false;
    mocks.killSwitch = false;
    mocks.conflict = false;
    mocks.eventType = 'bank-transfer.inflow.success';
    mocks.process.mockResolvedValue(new Response('{}', { status: 200 }));
  });

  it.each([
    'interest-accrued.success',
    'bank-transfer.inflow.success',
    'interest-payout.success',
  ])('runs the existing verified-delivery path for %s', async (eventType) => {
    mocks.eventType = eventType;
    const result = await replayLegacyDelivery(delivery());
    expect(result).toEqual({ status: 200 });
    expect(mocks.process).toHaveBeenCalledWith(
      expect.objectContaining({
        rawBody: delivery().rawBody,
        signature: 'exact-stored-signature',
        matchedSecret: 'synthetic-key',
        families: ['legacy'],
        keyScope: 'replay',
      }),
      expect.objectContaining({
        createClient: expect.any(Function),
        env: process.env,
      })
    );
    expect(mocks.dispose).not.toHaveBeenCalled();
  });

  it('does not widen a wrong-family or incomplete key set', async () => {
    await expect(
      replayLegacyDelivery(
        delivery({ families: ['bank'], recordedFamilies: ['bank'] })
      )
    ).resolves.toEqual({ status: 200, authorizationQuarantine: true });
    await expect(
      replayLegacyDelivery(
        delivery({ families: ['legacy'], recordedFamilies: ['bank'] })
      )
    ).resolves.toEqual({ status: 200, authorizationQuarantine: true });
    await expect(
      replayLegacyDelivery(delivery({ incompleteKeySet: true }))
    ).resolves.toEqual({ status: 503, keySetIncomplete: true });
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it('carries quarantine and deferral markers through a 200 response', async () => {
    mocks.content = true;
    mocks.authorization = true;
    mocks.incomplete = true;
    mocks.killSwitch = true;
    mocks.conflict = true;
    const result = await replayLegacyDelivery(delivery());
    expect(result).toEqual({
      status: 200,
      contentQuarantine: true,
      authorizationQuarantine: true,
      keySetIncomplete: true,
      killSwitchDeferred: true,
      conflict: true,
    });
  });

  it('disposes the lazy intake client when processing throws', async () => {
    mocks.process.mockImplementation(async (_delivery, deps) => {
      deps.createClient();
      throw new Error('synthetic processing failure');
    });
    await expect(replayLegacyDelivery(delivery())).rejects.toThrow(
      'synthetic processing failure'
    );
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it('never creates the intake client when verification is incomplete', async () => {
    const createClient = vi.fn(() => ({ dispose: vi.fn() }) as never);
    await replayLegacyDelivery(
      delivery({ incompleteKeySet: true }),
      process.env,
      { createClient }
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    false,
    true,
  ])('preserves processing success when disposal rejects (async: %s)', async (asynchronous) => {
    mocks.process.mockImplementation(async (_delivery, deps) => {
      deps.createClient();
      return new Response('{}', { status: 200 });
    });
    const dispose = vi.fn(() => {
      if (asynchronous)
        return Promise.reject(new Error('synthetic disposal failure'));
      throw new Error('synthetic disposal failure');
    });
    await expect(
      replayLegacyDelivery(delivery(), process.env, {
        createClient: () => ({ dispose }) as never,
      })
    ).resolves.toEqual({ status: 200 });
    expect(dispose).toHaveBeenCalledOnce();
  });
});
