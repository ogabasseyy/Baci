import { beforeEach, expect, it, vi } from 'vitest';
import { dispatchPrimaryWalletInflow } from './primary-wallet-inflow-dispatch';
import { readPrimaryWalletInflowRuntime } from './primary-wallet-inflow-runtime';
import { applyPrimaryWalletSignedInflow } from './primary-wallet-signed-inflow';

vi.mock('server-only', () => ({}));
vi.mock('./primary-wallet-inflow-runtime', () => ({
  readPrimaryWalletInflowRuntime: vi.fn(),
}));
vi.mock('./primary-wallet-inflow-executor', () => ({
  createPrimaryWalletInflowExecutor: vi.fn(() => vi.fn()),
}));
vi.mock('./primary-wallet-signed-inflow', () => ({
  applyPrimaryWalletSignedInflow: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
it('does not intercept legacy inflows while explicitly disabled', async () => {
  vi.mocked(readPrimaryWalletInflowRuntime).mockReturnValue(null);
  expect(
    await dispatchPrimaryWalletInflow({
      rawBody: new Uint8Array(),
      signature: null,
      secret: undefined,
    })
  ).toBe('disabled');
  expect(applyPrimaryWalletSignedInflow).not.toHaveBeenCalled();
});
it('does not fall back to legacy credit when enabled configuration is invalid', async () => {
  vi.mocked(readPrimaryWalletInflowRuntime).mockImplementation(() => {
    throw new Error('Unavailable');
  });
  await expect(
    dispatchPrimaryWalletInflow({
      rawBody: new Uint8Array(),
      signature: null,
      secret: undefined,
    })
  ).rejects.toThrow('Unavailable');
  expect(applyPrimaryWalletSignedInflow).not.toHaveBeenCalled();
});
