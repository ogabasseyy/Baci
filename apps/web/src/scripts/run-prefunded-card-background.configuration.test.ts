import { afterEach, expect, it, vi } from 'vitest';
import { buildPrefundedCardActivationConfig } from '../lib/piggyvest/prefunded-card-activation-config';
import { createActivationConfigFixture } from '../lib/piggyvest/prefunded-card-activation-config.test-support';
import { createPrefundedCardComposition } from '../lib/piggyvest/prefunded-card-composition';

const mocks = vi.hoisted(() => ({
  readConfiguration: vi.fn(),
  run: vi.fn(async () => ({ status: 'completed' })),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const owner = process.getuid?.() ?? -1;
  const file = {
    isFile: () => true,
    isSymbolicLink: () => false,
    uid: owner,
    mode: 0o600,
    nlink: 1,
    dev: 1,
    ino: 2,
  };
  const filesystem = {
    ...actual,
    lstatSync: (path: string) =>
      path.endsWith('runner.lock')
        ? file
        : { ...file, isDirectory: () => true, mode: 0o700 },
    fstatSync: () => file,
  };
  return { ...filesystem, default: filesystem };
});
vi.mock('../lib/piggyvest/prefunded-card-activation-config-file', () => ({
  readPrefundedCardActivationConfig: mocks.readConfiguration,
}));
vi.mock('../lib/piggyvest/prefunded-card-postgres-executor', () => ({
  createPrefundedCardPostgresExecutor: () => vi.fn(),
}));
vi.mock(
  '../lib/piggyvest/prefunded-card-checkout-recovery-runner-file-store',
  () => ({
    createPrefundedCardCheckoutRecoveryRunnerFileStore: () => ({}),
  })
);
vi.mock('../lib/piggyvest/prefunded-card-background-runner', () => ({
  createPrefundedCardBackgroundRunner: () => ({ run: mocks.run }),
}));

const originalExitCode = process.exitCode;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = originalExitCode;
});

it('constructs the dispatcher from validated raw input, not the transformed profiles', async () => {
  const source = createActivationConfigFixture();
  const parsed = buildPrefundedCardActivationConfig(
    source,
    new Date('2026-09-27T12:00:00Z')
  );
  expect(parsed.ok).toBe(true);
  expect(() =>
    createPrefundedCardComposition({
      configuration: source.background,
      fetchImplementation: fetch,
    })
  ).not.toThrow();
  mocks.readConfiguration.mockResolvedValue({ ...parsed, source });
  vi.stubEnv('PREFUNDED_CARD_BACKGROUND_LOCK_HELD', '1');
  const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  await import('./run-prefunded-card-background');

  await vi.waitFor(() => expect(output).toHaveBeenCalled());
  expect(mocks.readConfiguration).toHaveBeenCalledOnce();
  expect(output).toHaveBeenCalledWith('{"status":"completed"}');
  expect(mocks.run).toHaveBeenCalledOnce();
});
