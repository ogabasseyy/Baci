import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('./primary-wallet-card-transfer-cli', () => ({
  primaryCardTransferCli: mocks.launch,
}));
const previous = process.exitCode;
afterEach(() => {
  process.exitCode = previous;
  vi.restoreAllMocks();
  vi.resetModules();
});
it('does not acknowledge durable unknown acceptance as successful scheduler completion', async () => {
  mocks.launch.mockResolvedValueOnce({
    mode: 'once',
    status: 'reconciliation_required',
    fundingComplete: false,
  });
  const stdout = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  await import('./primary-wallet-card-transfer-entry');
  await Promise.resolve();
  expect(process.exitCode).toBe(2);
  expect(stdout).toHaveBeenCalledWith(
    '{"mode":"once","status":"reconciliation_required","fundingComplete":false}\n'
  );
  expect(stderr).toHaveBeenCalledWith(
    'Primary card transfer reconciliation required\n'
  );
});
it('passes the readiness probe despite a stuck-sibling backlog', async () => {
  mocks.launch.mockResolvedValueOnce({
    mode: 'readiness',
    status: 'reconciliation_required',
    fundingComplete: false,
  });
  const stdout = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  await import('./primary-wallet-card-transfer-entry');
  await Promise.resolve();
  expect(process.exitCode).toBe(previous);
  expect(stdout).toHaveBeenCalledWith(
    '{"mode":"readiness","status":"reconciliation_required","fundingComplete":false}\n'
  );
  expect(stderr).not.toHaveBeenCalled();
});
it('redacts operational failures while returning a failing process status', async () => {
  mocks.launch.mockRejectedValueOnce(new Error('private-provider-material'));
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  await import('./primary-wallet-card-transfer-entry');
  await Promise.resolve();
  expect(stderr).toHaveBeenCalledWith(
    'Primary card transfer worker unavailable\n'
  );
  expect(process.exitCode).toBe(1);
});
