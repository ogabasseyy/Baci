import { describe, expect, it } from 'vitest';
import { getRedvaultCallbackUrl } from './redvault-callback-url';

const input = {
  merchantSlug: 'ogabassey',
  protocol: 'https' as const,
  rootDomain: 'usebaci.com',
};

describe('getRedvaultCallbackUrl', () => {
  it('returns to the slug-prefixed storefront on an isolated Vercel Preview', () => {
    expect(
      getRedvaultCallbackUrl({
        ...input,
        runtimeEnv: 'staging',
        vercelEnv: 'preview',
        vercelUrl: 'baci-example-team.vercel.app',
      })
    ).toBe('https://baci-example-team.vercel.app/ogabassey/checkout/success');
  });

  it('preserves the merchant-domain callback outside Preview', () => {
    expect(
      getRedvaultCallbackUrl({
        ...input,
        runtimeEnv: 'production',
        vercelEnv: 'production',
        vercelUrl: 'baci-example-team.vercel.app',
      })
    ).toBe('https://ogabassey.usebaci.com/checkout/success');
  });

  it.each([
    '',
    'example.com',
    'evil.vercel.app.example.com',
  ])('rejects an invalid Preview host %s', (vercelUrl) => {
    expect(() =>
      getRedvaultCallbackUrl({
        ...input,
        runtimeEnv: 'staging',
        vercelEnv: 'preview',
        vercelUrl,
      })
    ).toThrow('REDVAULT Preview callback host is unavailable');
  });
});
