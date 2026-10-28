import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  buildStrictCspResponse,
  generateCSP,
  shouldForwardStrictCspNonce,
} from './csp';

describe('proxy CSP', () => {
  it('uses a nonce only for admin and auth document routes', () => {
    expect(shouldForwardStrictCspNonce('admin')).toBe(true);
    expect(shouldForwardStrictCspNonce('storefront')).toBe(false);
    expect(generateCSP('admin', false, 'safe_nonce')).toContain(
      "'nonce-safe_nonce'"
    );
    expect(generateCSP('storefront', false)).toContain("'unsafe-inline'");
  });

  it('forwards exactly the generated strict CSP to the request', () => {
    const { nonce, response } = buildStrictCspResponse(
      new NextRequest('https://usebaci.com/dashboard'),
      'admin',
      false
    );
    const forwarded = response.headers.get(
      'x-middleware-request-content-security-policy'
    );
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(forwarded).toContain(`'nonce-${nonce}'`);
  });
});

const socialScriptOrigins = [
  'https://connect.facebook.net',
  'https://analytics.tiktok.com',
  'https://sc-static.net',
  'https://tr.snapchat.com',
  'https://static.ads-twitter.com',
];
const socialCollectorOrigins = [
  'https://www.facebook.com',
  'https://analytics.tiktok.com',
  'https://tr.snapchat.com',
  'https://tr6.snapchat.com',
  'https://analytics.twitter.com',
  'https://analytics.x.com',
  'https://t.co',
];
function directive(policy: string, name: string): string[] {
  return (
    policy
      .split('; ')
      .find((part) => part.startsWith(`${name} `))
      ?.split(' ')
      .slice(1) ?? []
  );
}
it('permits consent-gated social SDKs and collectors only on storefronts', () => {
  const policy = generateCSP('storefront', false);
  expect(directive(policy, 'script-src')).toEqual(
    expect.arrayContaining(socialScriptOrigins)
  );
  expect(directive(policy, 'connect-src')).toEqual(
    expect.arrayContaining(socialCollectorOrigins)
  );
  expect(directive(policy, 'script-src')).not.toContain("'unsafe-eval'");
  expect(directive(policy, 'default-src')).toEqual(["'self'"]);
  for (const source of [
    ...directive(policy, 'script-src'),
    ...directive(policy, 'connect-src'),
  ]) {
    expect(source).not.toMatch(
      /\*\.(facebook|tiktok|snapchat|twitter|x)\.(com|net)/
    );
  }
});
it.each([
  'admin',
  'auth',
  'api',
] as const)('keeps social SDKs and collectors out of %s CSP', (route) => {
  const policy = generateCSP(route, false, 'test_nonce');
  for (const origin of [...socialScriptOrigins, ...socialCollectorOrigins])
    expect(policy).not.toContain(origin);
  if (route !== 'api') {
    expect(directive(policy, 'script-src')).toContain("'nonce-test_nonce'");
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
  }
});

it('allows the Snapchat SDK dynamic configuration script only on storefronts', () => {
  const configurationScript = new URL(
    'https://tr.snapchat.com/config/com/11111111-1111-4111-8111-111111111111.js'
  );
  expect(directive(generateCSP('storefront', false), 'script-src')).toContain(
    configurationScript.origin
  );
  for (const route of ['admin', 'auth', 'api'] as const)
    expect(
      directive(generateCSP(route, false, 'nonce'), 'script-src')
    ).not.toContain(configurationScript.origin);
});
