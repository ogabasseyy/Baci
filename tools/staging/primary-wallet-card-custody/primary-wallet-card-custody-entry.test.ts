import { expect, it, vi } from 'vitest';

vi.mock('./primary-wallet-card-custody-cli', () => ({
  primaryCardCustodyCli: vi.fn(async () => {
    throw new Error('private-provider-material');
  }),
}));
it('reports only sanitized launch failure and a retryable process failure', async () => {
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  const previous = process.exitCode;
  await import('./primary-wallet-card-custody-entry');
  await Promise.resolve();
  expect(stderr).toHaveBeenCalledWith(
    'Primary card custody launch unavailable\n'
  );
  expect(process.exitCode).toBe(1);
  process.exitCode = previous;
  stderr.mockRestore();
});
