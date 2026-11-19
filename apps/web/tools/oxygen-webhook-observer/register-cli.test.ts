// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn() }));
vi.mock('../../src/lib/payments/oxygen/transport', () => ({
  loginOxygenPartner: mocks.login,
}));
vi.mock('./register', () => ({ registerStagingObserver: mocks.register }));
const originalArgs = process.argv;
const originalExitCode = process.exitCode;
afterEach(() => {
  process.argv = originalArgs;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});
it('rejects a missing callback before login or registration', async () => {
  process.argv = ['node', 'register-cli.ts'];
  process.exitCode = 0;
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('./register-cli');
  await vi.waitFor(() => expect(process.exitCode).toBe(1));
  expect(mocks.login).not.toHaveBeenCalled();
  expect(mocks.register).not.toHaveBeenCalled();
  expect(errors).toHaveBeenCalledOnce();
});
