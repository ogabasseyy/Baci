import { beforeEach, expect, it, vi } from 'vitest';
import { runPrimaryCardCheckoutAbandonmentCli } from './primary-wallet-card-checkout-abandonment-cli';

const mocks = vi.hoisted(() => ({
  abandon: vi.fn(),
  runtime: vi.fn(),
  execute: vi.fn(),
  provider: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock(
  '@/lib/piggyvest/primary-wallet-card-checkout-abandonment',
  () => ({ runPrimaryCardCheckoutAbandonment: mocks.abandon })
);
vi.mock(
  '@/lib/piggyvest/primary-wallet-card-checkout-runtime',
  () => ({ readPrimaryWalletCardCheckoutRuntimeDrain: mocks.runtime })
);
vi.mock(
  '@/lib/piggyvest/primary-wallet-card-checkout-executor',
  () => ({ createPrimaryWalletCardCheckoutExecutor: mocks.execute })
);
vi.mock(
  '@/lib/piggyvest/primary-wallet-card-checkout-provider',
  () => ({ createPrimaryWalletCardCheckoutProvider: mocks.provider })
);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime.mockReturnValue({ settings: { integrationId: 'integration' } });
  mocks.execute.mockReturnValue('executor');
  mocks.provider.mockReturnValue('provider');
  mocks.abandon.mockResolvedValue({
    selected: 2,
    abandoned: 1,
    collected: 0,
    skipped: 1,
  });
});
it('runs plan without configuration, database or provider actions', async () => {
  const write = vi.fn();
  expect(
    await runPrimaryCardCheckoutAbandonmentCli({ argv: ['--plan'], write })
  ).toBe(0);
  expect(mocks.runtime).not.toHaveBeenCalled();
  expect(mocks.abandon).not.toHaveBeenCalled();
});
it.each([{ argv: [] }, { argv: ['--once', '--plan'] }, { argv: ['--unknown'] }])(
  'rejects invalid launch arguments without touching checkouts',
  async ({ argv }) => {
    expect(
      await runPrimaryCardCheckoutAbandonmentCli({ argv, write: vi.fn() })
    ).toBe(1);
    expect(mocks.abandon).not.toHaveBeenCalled();
  }
);
it('requires explicit owner approval before any abandonment', async () => {
  expect(
    await runPrimaryCardCheckoutAbandonmentCli({
      argv: ['--once'],
      env: { NODE_ENV: 'test' },
      write: vi.fn(),
    })
  ).toBe(1);
  expect(mocks.abandon).not.toHaveBeenCalled();
});
it('abandons at most 25 stale checkouts with a bounded runtime', async () => {
  const write = vi.fn();
  expect(
    await runPrimaryCardCheckoutAbandonmentCli({
      argv: ['--once'],
      env: {
        NODE_ENV: 'test' as const,
        PIGGYVEST_PRIMARY_CARD_ABANDONMENT_APPROVED: 'true',
      },
      write,
    })
  ).toBe(0);
  expect(mocks.abandon).toHaveBeenCalledWith({
    settings: { integrationId: 'integration' },
    execute: 'executor',
    provider: 'provider',
    signal: expect.any(AbortSignal),
  });
  expect(write).toHaveBeenCalledWith(
    '{"selected":2,"abandoned":1,"collected":0,"skipped":1}'
  );
});
it('redacts runtime errors on failure', async () => {
  mocks.abandon.mockRejectedValue(new Error('secret financial diagnostic'));
  const write = vi.fn();
  expect(
    await runPrimaryCardCheckoutAbandonmentCli({
      argv: ['--once'],
      env: {
        NODE_ENV: 'test' as const,
        PIGGYVEST_PRIMARY_CARD_ABANDONMENT_APPROVED: 'true',
      },
      write,
    })
  ).toBe(1);
  expect(write).toHaveBeenCalledWith('Primary card abandonment unavailable');
});
it('checks readiness without touching checkouts', async () => {
  const write = vi.fn();
  expect(
    await runPrimaryCardCheckoutAbandonmentCli({
      argv: ['--readiness'],
      env: {
        NODE_ENV: 'test' as const,
        PIGGYVEST_PRIMARY_CARD_ABANDONMENT_APPROVED: 'true',
      },
      write,
    })
  ).toBe(0);
  expect(mocks.abandon).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledWith('{"ready":true,"financialActions":false}');
});
