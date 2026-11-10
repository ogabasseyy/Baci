import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOxygenProvider } from './provider';
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
it.each([
  undefined,
  null,
  'invalid',
])('fails closed before token or network access for invalid environment %s', (environment) => {
  const token = vi.fn();
  const fetch = vi.fn();
  expect(() =>
    createOxygenProvider({ environment: environment as never, token, fetch })
  ).toThrow('Oxygen environment unavailable');
  expect(token).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
