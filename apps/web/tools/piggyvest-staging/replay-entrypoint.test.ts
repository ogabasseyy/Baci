import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  run: vi.fn(),
}));
vi.mock('./replay-prefunded-loader', () => ({
  loadPrefundedReplay: mocks.load,
}));
vi.mock('./replay-runtime-pass', () => ({
  runConfiguredReplayPass: mocks.run,
}));

import { runReplayEntrypoint } from './replay-entrypoint';
import { createPaidInterestTestFixture } from './replay-paid-interest.test-support';

const now = 1_900_000_000;
const token = (role: string) =>
  `header.${Buffer.from(JSON.stringify({ role, iat: now, exp: now + 3600 })).toString('base64url')}.synthetic`;
const configuration = () => ({
  environment: 'staging',
  receiptToken: token('pvb_staging_worker'),
  appToken: token('pvb_staging_app_worker'),
  receiptKey: Buffer.alloc(32, 1).toString('base64'),
  receiptSystemId: '7686901100561231906',
  appSystemId: '7685292944002592802',
});
const activation = {
  bundleSha256: 'a'.repeat(64),
  configurationSha256: 'b'.repeat(64),
};

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
  vi.stubEnv('NODE_ENV', 'test');
  mocks.load.mockReset();
  mocks.run.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('does not load prefunded code or credentials when activation is absent', async () => {
  await runReplayEntrypoint(configuration());
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(configuration(), {
    prefundedReplay: undefined,
  });
});

it('loads the pinned replay surface before the first receipt pass', async () => {
  const callbacks = { resolveEnrollment: vi.fn(), replay: vi.fn() };
  mocks.load.mockResolvedValue(callbacks);
  const configured = { ...configuration(), prefundedReplay: activation };
  await runReplayEntrypoint(configured);
  expect(mocks.load).toHaveBeenCalledExactlyOnceWith({
    activation,
    expectedAppSystemId: configured.appSystemId,
  });
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(configured, {
    prefundedReplay: callbacks,
  });
  expect(mocks.load.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.run.mock.invocationCallOrder[0]
  );
});

it('delegates paired loading and preclaim readiness to one configured pass without constructing twice', async () => {
  const sample = createPaidInterestTestFixture();
  await runReplayEntrypoint(sample.configuration);
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(sample.configuration);
});

it('redacts a paired preclaim failure without retrying or falling back', async () => {
  const sample = createPaidInterestTestFixture();
  mocks.run.mockRejectedValue(new Error('private interest password'));
  await expect(runReplayEntrypoint(sample.configuration)).rejects.toThrow(
    'Staging replay entrypoint refused'
  );
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.run).toHaveBeenCalledOnce();
});

it.each([
  { appSystemId: 'wrong-database' },
  { environment: 'production' },
  { prefundedReplay: { bundleSha256: 'incomplete' } },
])('refuses invalid configuration before runtime loading or claims', async (override) => {
  await expect(
    runReplayEntrypoint({ ...configuration(), ...override })
  ).rejects.toThrow('Staging replay entrypoint refused');
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});

it('refuses a production process before loading staging credentials', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  await expect(
    runReplayEntrypoint({
      ...configuration(),
      prefundedReplay: activation,
    })
  ).rejects.toThrow('Staging replay entrypoint refused');
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});

it('does not silently run legacy replay if enabled runtime loading fails', async () => {
  mocks.load.mockRejectedValue(new Error('credentials=private'));
  await expect(
    runReplayEntrypoint({
      ...configuration(),
      prefundedReplay: activation,
    })
  ).rejects.toThrow('Staging replay entrypoint refused');
  expect(mocks.run).not.toHaveBeenCalled();
});

it('redacts receipt pass failures without rerunning them', async () => {
  mocks.run.mockRejectedValue(new Error('private receipt payload'));
  await expect(runReplayEntrypoint(configuration())).rejects.toThrow(
    'Staging replay entrypoint refused'
  );
  expect(mocks.run).toHaveBeenCalledTimes(1);
});
