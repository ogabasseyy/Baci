import { beforeEach, expect, it, vi } from 'vitest';
import {
  goalCancelForfeitTransfersAllowed,
  runScheduledGoalCancelForfeitSweep,
} from './goal-cancel-forfeit-cron';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ live: vi.fn(), recovery: vi.fn() }));
vi.mock('./primary-wallet-savings-runtime', () => ({
  readPrimaryWalletSavingsRuntime: mocks.live,
  readPrimaryWalletSavingsRecoveryRuntime: mocks.recovery,
}));
vi.mock('./goal-cancel-forfeit-sweep', () => ({
  sweepPendingGoalCancelForfeits: vi.fn(),
}));

const runtime = {
  configuration: { c: 1 },
  reconciliationConfiguration: { e: 1 },
  providerToken: 't',
};
const env = {} as NodeJS.ProcessEnv;
const counts = { listed: 0, confirmed: 0, pending: 0, skipped: 0, failed: 0 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.recovery.mockReturnValue(runtime);
});

it('allows new forfeit transfers only while savings are switched on', () => {
  mocks.live.mockReturnValue(runtime);
  expect(goalCancelForfeitTransfersAllowed(env)).toBe(true);
  mocks.live.mockReturnValue(null);
  expect(goalCancelForfeitTransfersAllowed(env)).toBe(false);
  mocks.live.mockImplementation(() => {
    throw new Error('misconfigured');
  });
  expect(goalCancelForfeitTransfersAllowed(env)).toBe(false);
});

it('sweeps with the recovery credentials and the switch state', async () => {
  mocks.live.mockReturnValue(null);
  const sweep = vi.fn().mockResolvedValue(counts);
  expect(await runScheduledGoalCancelForfeitSweep(env, sweep)).toEqual(counts);
  expect(sweep).toHaveBeenCalledWith({ ...runtime, allowNewTransfers: false });
});

it('is inert where the savings credentials are not configured', async () => {
  mocks.recovery.mockImplementation(() => {
    throw new Error('not configured');
  });
  const sweep = vi.fn();
  expect(await runScheduledGoalCancelForfeitSweep(env, sweep)).toBeNull();
  expect(sweep).not.toHaveBeenCalled();
});

it('never throws when the sweep fails', async () => {
  mocks.live.mockReturnValue(runtime);
  const sweep = vi.fn().mockRejectedValue(new Error('db down'));
  expect(await runScheduledGoalCancelForfeitSweep(env, sweep)).toBeNull();
});
