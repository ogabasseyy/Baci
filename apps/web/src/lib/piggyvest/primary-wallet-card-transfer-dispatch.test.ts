import { expect, it, vi } from 'vitest';
import { dispatchPrimaryCardProviderTransfer } from './primary-wallet-card-transfer-dispatch';

it('rejects a cancelled dispatch before configuration, database or provider work', async () => {
  const fetchImplementation = vi.fn();
  await expect(
    dispatchPrimaryCardProviderTransfer({
      operationId: '10000000-0000-4000-8000-000000000099',
      environment: {},
      fetchImplementation,
      signal: AbortSignal.abort(),
    })
  ).rejects.toThrow('aborted');
  expect(fetchImplementation).not.toHaveBeenCalled();
});

it('cannot invoke provider or storage with missing trusted deployment approval', async () => {
  const fetchImplementation = vi.fn();
  await expect(
    dispatchPrimaryCardProviderTransfer({
      operationId: '10000000-0000-4000-8000-000000000099',
      environment: { NODE_ENV: 'test' },
      fetchImplementation,
    })
  ).rejects.toThrow('configuration unavailable');
  expect(fetchImplementation).not.toHaveBeenCalled();
});
