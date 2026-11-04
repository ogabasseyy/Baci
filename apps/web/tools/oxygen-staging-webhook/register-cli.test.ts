// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn() }));
vi.mock('../../src/lib/payments/oxygen/transport', () => ({
  loginOxygenPartner: mocks.login,
}));
vi.mock('../oxygen-webhook-observer/register', () => ({
  registerStagingObserver: mocks.register,
}));
const originalArgs = process.argv;
const originalExitCode = process.exitCode;
afterEach(() => {
  process.argv = originalArgs;
  process.exitCode = originalExitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it('fails before health checks, login or registration when binding is wrong', async () => {
  process.argv = ['node', 'register-cli.ts', 'https://example.test'];
  process.exitCode = 0;
  for (const [name, value] of Object.entries({
    OXYGEN_TEST_REFERENCE: 'test',
    OXYGEN_TEST_SECRET: 'secret',
    OXYGEN_CALLBACK_KEY: 'key',
    OXYGEN_CALLBACK_SECRET: 'secret',
    OXYGEN_CALLBACK_BINDING: 'wrong',
  }))
    vi.stubEnv(name, value);
  const fetcher = vi.spyOn(globalThis, 'fetch');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('./register-cli');
  await vi.waitFor(() => expect(process.exitCode).toBe(1));
  expect(fetcher).not.toHaveBeenCalled();
  expect(mocks.login).not.toHaveBeenCalled();
  expect(mocks.register).not.toHaveBeenCalled();
  expect(errors).toHaveBeenCalledOnce();
});
