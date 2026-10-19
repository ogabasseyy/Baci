import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkoutProxyConfig } from './checkout-proxy-config';

const baseline = {
  version: 3,
  routes: [
    {
      src: '^/api/storefront/customer/savings/goals$',
      dest: 'https://staging-auth.ogabassey.com/api/storefront/customer/savings/goals',
      methods: ['GET', 'POST'],
    },
    { handle: 'filesystem' },
  ],
};
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('staging checkout proxy configuration', () => {
  it('preserves reviewed routes and includes CSRF bootstrap for checkout mutations', () => {
    const before = JSON.stringify(baseline);
    const result = checkoutProxyConfig(baseline, digest(baseline));

    expect(result.routes[0]).toEqual(baseline.routes[0]);
    expect(result.routes.at(-1)).toEqual({ handle: 'filesystem' });
    expect(result.routes.slice(1, -1)).toEqual([
      {
        src: '^/api/storefront/customer/savings/card-checkout$',
        dest: 'https://staging-auth.ogabassey.com/api/storefront/customer/savings/card-checkout',
        methods: ['GET', 'POST', 'PATCH'],
      },
      { src: '^/api/storefront/customer/savings/card-checkout$', status: 405 },
      {
        src: '^/savings/card-return$',
        dest: 'https://staging-auth.ogabassey.com/savings/card-return',
        methods: ['GET', 'HEAD'],
      },
      { src: '^/savings/card-return$', status: 405 },
      {
        src: '^/api/csrf$',
        dest: 'https://staging-auth.ogabassey.com/api/csrf',
        methods: ['GET'],
      },
      { src: '^/api/csrf$', status: 405 },
      {
        src: '^/savings/card-assets/_next/static/([A-Za-z0-9_./-]+)$',
        dest: 'https://staging-auth.ogabassey.com/savings/card-assets/_next/static/$1',
        methods: ['GET', 'HEAD'],
      },
      {
        src: '^/savings/card-assets/_next/static/([A-Za-z0-9_./-]+)$',
        status: 405,
      },
    ]);
    expect(JSON.stringify(baseline)).toBe(before);
    expect(
      result.routes.some(
        (route) => 'src' in route && route.src === '^/api/webhooks/piggyvest$'
      )
    ).toBe(false);
  });

  it('refuses a changed baseline rather than overwriting existing routes', () => {
    expect(() => checkoutProxyConfig(baseline, '0'.repeat(64))).toThrow(
      'baseline'
    );
  });

  it('exposes callback assets without claiming the shared Next asset namespace', () => {
    const result = checkoutProxyConfig(baseline, digest(baseline));
    const matches = (path: string) =>
      result.routes.filter(
        (route) =>
          'src' in route &&
          typeof route.src === 'string' &&
          new RegExp(route.src).test(path)
      );
    expect(
      matches('/savings/card-assets/_next/static/css/abc.css')
    ).toHaveLength(2);
    expect(matches('/_next/static/css/abc.css')).toHaveLength(0);
    expect(matches('/savings/card-assets/_next/server/app.js')).toHaveLength(0);
  });

  it('does not expose saved-card debits when activating only first-card checkout', () => {
    const result = checkoutProxyConfig(baseline, digest(baseline));
    expect(
      result.routes.some(
        (route) =>
          'src' in route &&
          typeof route.src === 'string' &&
          new RegExp(route.src).test(
            '/api/storefront/customer/savings/card-contributions'
          )
      )
    ).toBe(false);
  });

  it.each([
    {},
    { ...baseline, version: 2 },
    { ...baseline, rewrites: [] },
    { ...baseline, routes: [{ handle: 'filesystem' }, baseline.routes[0]] },
    {
      ...baseline,
      routes: [
        { src: '^/api/.*$', dest: 'https://other.invalid' },
        { handle: 'filesystem' },
      ],
    },
    {
      ...baseline,
      routes: [
        { src: '^/savings/card-return$', status: 404 },
        { handle: 'filesystem' },
      ],
    },
    {
      ...baseline,
      routes: [
        {
          src: '^/api/storefront/customer/savings/card-contributions$',
          dest: 'https://staging-auth.ogabassey.com/api/storefront/customer/savings/card-contributions',
        },
        { handle: 'filesystem' },
      ],
    },
  ])('refuses unsafe route precedence or unsupported configuration: %j', (config) => {
    expect(() => checkoutProxyConfig(config, digest(config))).toThrow(
      'baseline'
    );
  });

  it('refuses duplicate installation even with a new baseline digest', () => {
    const result = checkoutProxyConfig(baseline, digest(baseline));
    expect(() => checkoutProxyConfig(result, digest(result))).toThrow(
      'baseline'
    );
  });
});
