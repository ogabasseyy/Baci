import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { OxygenProviderFailure } from './provider';
import { trackOxygenExecution } from './runtime-failure';

it.each([
  'not_sent',
  'rejected',
] as const)('releases a mutation with definite %s outcome', async (outcome) => {
  const tracked = trackOxygenExecution({
    call: async () => {
      throw new OxygenProviderFailure(outcome);
    },
  });
  await expect(
    tracked.provider.call('validate_existing', {})
  ).rejects.toThrow();
  expect(tracked.uncertain()).toBe(false);
});
it('retains uncertainty for a mutation timeout', async () => {
  const tracked = trackOxygenExecution({
    call: async () => {
      throw new OxygenProviderFailure('indeterminate');
    },
  });
  await expect(tracked.provider.call('book', {})).rejects.toThrow();
  expect(tracked.uncertain()).toBe(true);
});
it('a read timeout and local validation do not create mutation uncertainty', async () => {
  const tracked = trackOxygenExecution({
    call: async () => {
      throw new Error('timeout');
    },
  });
  expect(tracked.uncertain()).toBe(false);
  await expect(tracked.provider.call('kyc', {})).rejects.toThrow();
  expect(tracked.uncertain()).toBe(false);
});
it('preserves a successful mutation when a subsequent read fails', async () => {
  const tracked = trackOxygenExecution({
    call: vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('timeout')),
  });
  await tracked.provider.call('book', {});
  await expect(tracked.provider.call('details', {})).rejects.toThrow();
  expect(tracked.uncertain()).toBe(true);
});
