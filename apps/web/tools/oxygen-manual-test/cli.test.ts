// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

const originalArgs = process.argv;
const originalExitCode = process.exitCode;
afterEach(() => {
  process.argv = originalArgs;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

it('rejects missing or conflicting environment selection before opening a server', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const args of [
    [],
    ['--staging', '--production'],
    ['--dev', '--staging'],
  ]) {
    vi.resetModules();
    process.exitCode = 0;
    process.argv = ['node', 'cli.ts', ...args];
    await import('./cli');
    await vi.waitFor(() => expect(process.exitCode).toBe(1));
  }
  expect(errors).toHaveBeenCalledTimes(3);
  expect(errors).toHaveBeenCalledWith('Local test startup failed.');
});
