import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./transport', () => ({ loginOxygenPartner: mocks.login }));

import { oxygenRuntimeProviderToken } from './runtime-provider-token-cache';

it('bounds retained identities and preserves distinct credential scopes', async () => {
  mocks.login.mockImplementation(async () => ({
    token: 'synthetic',
    expiresAtMs: Date.now() + 300_000,
  }));
  const base = {
    environment: 'staging' as const,
    baseUrl: 'https://staging.example.test',
    reference: 'partner',
    secret: 'secret',
  };
  await oxygenRuntimeProviderToken(base);
  await oxygenRuntimeProviderToken(base);
  expect(mocks.login).toHaveBeenCalledTimes(1);
  for (let index = 0; index < 16; index++)
    await oxygenRuntimeProviderToken({
      ...base,
      reference: `partner-${index}`,
    });
  expect(mocks.login).toHaveBeenCalledTimes(17);
  await oxygenRuntimeProviderToken(base);
  expect(mocks.login).toHaveBeenCalledTimes(18);
});
