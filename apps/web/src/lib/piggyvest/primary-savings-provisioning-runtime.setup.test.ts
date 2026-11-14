import { beforeEach, expect, it, vi } from 'vitest';
import { provisioningFixture } from './primary-savings-provisioning.test-support';
import {
  readPrimarySavingsProvisioningRuntime,
  runPrimarySavingsProvisioning,
} from './primary-savings-provisioning-runtime';

const mocks = vi.hoisted(() => ({
  primary: vi.fn(),
  drain: vi.fn(),
  setup: vi.fn(),
  provision: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./primary-wallet-runtime', () => ({
  readPrimaryWalletRuntime: mocks.primary,
  readPrimaryWalletRuntimeDrain: mocks.drain,
}));
vi.mock('./primary-savings-provisioning-executor', () => ({
  createPrimarySavingsProvisioningExecutor: vi.fn(),
}));
vi.mock('./primary-savings-provisioning-store', () => ({
  createPrimarySavingsProvisioningStore: vi.fn(),
}));
vi.mock('./primary-savings-goal-setup', () => ({
  setupPrimarySavingsGoal: mocks.setup,
}));
vi.mock('./primary-savings-provisioning', () => ({
  provisionPrimarySavingsWallet: mocks.provision,
}));
const env = {
  NODE_ENV: 'test' as const,
  PIGGYVEST_PRIMARY_SAVINGS_PROVISIONING_ENABLED: 'true',
  PIGGYVEST_PRIMARY_GOAL_PROVISIONER_DB_PASSWORD: 'test-only-password',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.primary.mockReturnValue(provisioningFixture.configuration);
  mocks.drain.mockReturnValue(provisioningFixture.configuration);
  mocks.setup.mockResolvedValue({ status: 'pending' });
});
it('keeps setup behind the same rollout flag and kill switch as provisioning', () => {
  expect(
    readPrimarySavingsProvisioningRuntime({ NODE_ENV: 'test' }, 'setup')
  ).toBeNull();
  expect(
    readPrimarySavingsProvisioningRuntime(
      { ...env, PIGGYVEST_KILL_SWITCH: 'true' },
      'setup'
    )
  ).toBeNull();
  expect(readPrimarySavingsProvisioningRuntime(env, 'setup')).not.toBeNull();
  expect(mocks.drain).not.toHaveBeenCalled();
});
it('routes setup to the status-gated flow with the requested choice only as a fallback', async () => {
  await runPrimarySavingsProvisioning({
    configuration: provisioningFixture.configuration,
    scope: provisioningFixture.scope,
    goalId: provisioningFixture.goalId,
    mode: 'setup',
    interestAccepted: true,
  });
  expect(mocks.provision).not.toHaveBeenCalled();
  expect(mocks.setup).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      goalId: provisioningFixture.goalId,
      requestedInterest: true,
    })
  );
  expect(mocks.setup.mock.calls[0][0]).not.toHaveProperty('mode');
});
