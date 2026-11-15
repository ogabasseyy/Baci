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
const counts = {
  listed: 0,
  confirmed: 0,
  pending: 0,
  attention: 0,
  skipped: 0,
  failed: 0,
  deferred: 0,
};
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

it('passes the caller deadline to the sweep', async () => {
  mocks.live.mockReturnValue(runtime);
  const sweep = vi.fn().mockResolvedValue(counts);
  await runScheduledGoalCancelForfeitSweep(env, sweep, 12345);
  expect(sweep).toHaveBeenCalledWith({
    ...runtime,
    allowNewTransfers: true,
    deadlineAt: 12345,
  });
});

it('is inert where the savings credentials are not configured', async () => {
  mocks.recovery.mockImplementation(() => {
    throw new Error('not configured');
  });
  const sweep = vi.fn();
  expect(await runScheduledGoalCancelForfeitSweep(env, sweep)).toBeNull();
  expect(sweep).not.toHaveBeenCalled();
});

it('reports a failed sweep distinctly from an inert one, and never throws', async () => {
  mocks.live.mockReturnValue(runtime);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const sweep = vi.fn().mockRejectedValue(new Error('db down'));
  expect(await runScheduledGoalCancelForfeitSweep(env, sweep)).toEqual({
    status: 'failed',
  });
  expect(warn).toHaveBeenCalledWith(
    '[PiggyVest] Goal cancel forfeit sweep failed:',
    'db down'
  );
  warn.mockRestore();
});

it('reports a configured-but-broken installation as a failed sweep, never inert', async () => {
  mocks.recovery.mockImplementation(() => {
    throw new Error('Primary savings configuration unavailable');
  });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const sweep = vi.fn();
  expect(
    await runScheduledGoalCancelForfeitSweep(
      {
        PIGGYVEST_PRIMARY_AUTHORIZER_DB_PASSWORD: 'x',
      } as unknown as NodeJS.ProcessEnv,
      sweep
    )
  ).toEqual({ status: 'failed' });
  expect(sweep).not.toHaveBeenCalled();
  warn.mockRestore();
});

it('stays inert where only another PiggyVest subsystem is configured', async () => {
  mocks.recovery.mockImplementation(() => {
    throw new Error('Primary savings configuration unavailable');
  });
  expect(
    await runScheduledGoalCancelForfeitSweep(
      { PIGGYVEST_PRIMARY_CARD_KEY: 'x' } as unknown as NodeJS.ProcessEnv,
      vi.fn()
    )
  ).toBeNull();
});

it('reports a failed sweep when an established installation lost its authorizer password', async () => {
  mocks.recovery.mockImplementation(() => {
    throw new Error('Primary savings configuration unavailable');
  });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  expect(
    await runScheduledGoalCancelForfeitSweep(
      {
        PIGGYVEST_PRIMARY_INTEGRATION_ID: 'id',
        PIGGYVEST_PRIMARY_DB_HOST: 'db.example.com',
        PIGGYVEST_INTEREST_WALLET_ID: 'wallet',
      } as unknown as NodeJS.ProcessEnv,
      vi.fn()
    )
  ).toEqual({ status: 'failed' });
  warn.mockRestore();
});

it('stays inert for a primary wallet installed without savings', async () => {
  mocks.recovery.mockImplementation(() => {
    throw new Error('Primary savings configuration unavailable');
  });
  expect(
    await runScheduledGoalCancelForfeitSweep(
      {
        PIGGYVEST_PRIMARY_INTEGRATION_ID: 'id',
        PIGGYVEST_PRIMARY_DB_HOST: 'db.example.com',
      } as unknown as NodeJS.ProcessEnv,
      vi.fn()
    )
  ).toBeNull();
});
