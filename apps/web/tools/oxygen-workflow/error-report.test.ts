// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
const originalArgs = process.argv;
const originalExitCode = process.exitCode;
afterEach(() => {
  process.argv = originalArgs;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});
it('rejects a missing private config and workflow before constructing a database client', async () => {
  process.argv = ['node', 'error-report.ts'];
  process.exitCode = 0;
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  await import('./error-report');
  await vi.waitFor(() => expect(process.exitCode).toBe(1));
  expect(mocks.createClient).not.toHaveBeenCalled();
  expect(errors).toHaveBeenCalledOnce();
  expect(errors.mock.calls[0][0]).not.toContain('password');
});
