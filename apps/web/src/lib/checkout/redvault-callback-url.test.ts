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

  it('routes local staging at the loopback base URL without a root domain', () => {
    expect(
      getRedvaultCallbackUrl({
        ...input,
        rootDomain: '',
        runtimeEnv: 'staging',
        localBaseUrl: 'http://localhost:3000',
      })
    ).toBe('http://localhost:3000/ogabassey/checkout/success');
    expect(
      getRedvaultCallbackUrl({
        ...input,
        rootDomain: '',
        runtimeEnv: 'staging',
        vercelEnv: 'development',
        localBaseUrl: 'http://127.0.0.1:3001/shop?x=1#y',
      })
    ).toBe('http://127.0.0.1:3001/ogabassey/checkout/success');
  });

  it.each([
    ['missing base URL', undefined],
    ['empty base URL', ''],
    ['non-URL', 'not-a-url'],
    ['non-loopback host', 'https://staging.usebaci.com'],
    ['loopback suffix trick', 'https://localhost.evil.example'],
    ['non-http protocol', 'ftp://localhost/x'],
  ])('rejects local staging with %s', (_label, localBaseUrl) => {
    expect(() =>
      getRedvaultCallbackUrl({
        ...input,
        rootDomain: '',
        runtimeEnv: 'staging',
        localBaseUrl,
      })
    ).toThrow('REDVAULT local callback host is unavailable');
  });

  it('still rejects a bad slug in local staging', () => {
    expect(() =>
      getRedvaultCallbackUrl({
        ...input,
        merchantSlug: 'evil.shop/x',
        rootDomain: '',
        runtimeEnv: 'staging',
        localBaseUrl: 'http://localhost:3000',
      })
    ).toThrow('REDVAULT callback host is unavailable');
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

  it.each([
    ['slash in slug', { merchantSlug: 'evil.shop/x' }],
    ['at-sign in slug', { merchantSlug: 'evil@shop' }],
    ['empty slug', { merchantSlug: '' }],
    ['root domain without TLD', { rootDomain: 'usebaci' }],
    ['path in root domain', { rootDomain: 'usebaci.com/evil' }],
    ['empty root domain', { rootDomain: '' }],
  ])('rejects %s in any environment', (_label, override) => {
    for (const env of [
      { runtimeEnv: 'production', vercelEnv: 'production' },
      {
        runtimeEnv: 'staging',
        vercelEnv: 'preview',
        vercelUrl: 'baci-example-team.vercel.app',
      },
    ]) {
      expect(() =>
        getRedvaultCallbackUrl({ ...input, ...env, ...override })
      ).toThrow('REDVAULT callback host is unavailable');
    }
  });
});
