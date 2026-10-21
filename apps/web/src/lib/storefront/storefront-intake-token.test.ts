import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStorefrontIntakeToken } from './storefront-intake-token';

vi.mock('server-only', () => ({}));

const tokenFor = (role: string) =>
  `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;

describe('storefront intake token', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it('returns the restricted credential when well-formed', () => {
    const token = tokenFor('storefront_intake');
    vi.stubEnv('SUPABASE_STOREFRONT_INTAKE_KEY', token);

    expect(getStorefrontIntakeToken()).toBe(token);
  });
  it.each([
    '',
    'malformed',
    'only.two.parts.extra',
    tokenFor('service_role'),
    tokenFor('authenticated'),
    tokenFor('anon'),
  ])('rejects an unavailable or privileged credential', (token) => {
    vi.stubEnv('SUPABASE_STOREFRONT_INTAKE_KEY', token);

    expect(() => getStorefrontIntakeToken()).toThrow(
      'Restricted storefront intake credential is unavailable'
    );
  });
});
