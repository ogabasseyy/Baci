import { expect, it, vi } from 'vitest';
import { readPrimaryWalletInflowRuntime } from './primary-wallet-inflow-runtime';

vi.mock('server-only', () => ({}));

it('leaves the legacy handler unchanged when primary inflows are not enabled', () => {
  expect(readPrimaryWalletInflowRuntime({ NODE_ENV: 'test' })).toBeNull();
});
it('refuses enabled but incomplete configuration rather than silently losing primary inflows', () => {
  expect(() =>
    readPrimaryWalletInflowRuntime({
      NODE_ENV: 'test',
      PIGGYVEST_PRIMARY_INFLOWS_ENABLED: 'true',
    })
  ).toThrow('configuration unavailable');
});
