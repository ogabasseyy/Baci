import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOxygenProvider } from './provider';
import { assertOxygenProviderEnvironment } from './provider-environment';
import { trackOxygenExecution } from './runtime-failure';

it.each([
  'staging',
  'production',
] as const)('preserves the selected %s environment through the execution wrapper', (environment) => {
  const provider = createOxygenProvider({
    environment,
    token: async () => 'unused',
    fetch: vi.fn(),
  });
  expect(provider.environment).toBe(environment);
  expect(trackOxygenExecution(provider).provider.environment).toBe(environment);
});
it('defaults the actual adapter to staging and rejects a production claim', () => {
  const provider = createOxygenProvider({
    token: async () => 'unused',
    fetch: vi.fn(),
  });
  expect(provider.environment).toBe('staging');
  expect(() =>
    assertOxygenProviderEnvironment(provider, 'production')
  ).toThrow();
});
