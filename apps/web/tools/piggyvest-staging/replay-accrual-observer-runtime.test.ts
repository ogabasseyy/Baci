import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ configuration: vi.fn(), postgres: vi.fn() }));
vi.mock('./replay-accrual-observer-config', () => ({
  readAccrualObserverConfiguration: state.configuration,
}));
vi.mock('./replay-accrual-observer-postgres', () => ({
  createAccrualObserverPostgres: state.postgres,
}));

import { createAccrualObserverTestFixture } from './replay-accrual-observer.test-support';
import { createAccrualObserverReplay } from './replay-accrual-observer-runtime';

it('checks the observer connection before returning a signed-only accrual callback', async () => {
  vi.clearAllMocks();
  const sample = createAccrualObserverTestFixture();
  state.configuration.mockResolvedValue({
    observer: sample.observer,
    signingSecret: sample.secret,
    scope: {
      integrationId: sample.scope.integrationId,
      businessId: sample.scope.businessId,
      expectedSystemId: sample.configuration.appSystemId,
    },
  });
  const execute = vi.fn();
  state.postgres.mockResolvedValue(execute);
  const callback = await createAccrualObserverReplay({
    observer: sample.observer,
    activation: sample.configuration.prefundedReplay,
    expectedAppSystemId: sample.configuration.appSystemId,
  });
  expect(typeof callback).toBe('function');
  expect(state.postgres).toHaveBeenCalledExactlyOnceWith(sample.observer);
  expect(execute).not.toHaveBeenCalled();
});

it.each([
  'configuration',
  'postgres',
] as const)('redacts %s failures and returns no unchecked callback', async (field) => {
  vi.clearAllMocks();
  const sample = createAccrualObserverTestFixture();
  state.configuration.mockResolvedValue({ observer: sample.observer });
  state[field].mockRejectedValueOnce(new Error('private-secret-marker'));
  await expect(
    createAccrualObserverReplay({
      observer: sample.observer,
      activation: sample.configuration.prefundedReplay,
      expectedAppSystemId: sample.configuration.appSystemId,
    })
  ).rejects.toThrow('Staging accrual observer unavailable');
  if (field === 'configuration') expect(state.postgres).not.toHaveBeenCalled();
});
