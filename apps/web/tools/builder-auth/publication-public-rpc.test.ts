import { expect, it } from 'vitest';
import {
  allowedPublicHomePreflight,
  isBoundPublicHomeRpc,
  publicHomeRpcCors,
} from './publication-public-rpc';

const binding = {
  origin: 'https://fixture.supabase.co',
  publishableKey: 'fixture-public',
  merchantId: 'merchant',
};
const url = `${binding.origin}/rest/v1/rpc/builder_public_home?p_merchant=merchant`;
it('binds CORS and egress to the exact configured public RPC and merchant', () => {
  expect(isBoundPublicHomeRpc(url, binding)).toBe(true);
  for (const value of [
    url.replace('fixture.supabase.co', 'other.supabase.co'),
    url.replace('merchant', 'other'),
    `${url}&extra=1`,
    url.replace('builder_public_home', 'private_rpc'),
    url.replace('https:', 'http:'),
  ])
    expect(isBoundPublicHomeRpc(value, binding)).toBe(false);
  expect(isBoundPublicHomeRpc(url)).toBe(false);
});
it('permits only the expected storefront GET preflight with public-client headers', () => {
  const origin = 'https://store.usebaci.com';
  const headers = {
    origin,
    'access-control-request-method': 'GET',
    'access-control-request-headers': 'apikey, authorization, x-client-info',
  };
  expect(allowedPublicHomePreflight(headers, origin)).toBe(true);
  expect(
    allowedPublicHomePreflight(
      { ...headers, origin: 'https://evil.invalid' },
      origin
    )
  ).toBe(false);
  expect(
    allowedPublicHomePreflight(
      { ...headers, 'access-control-request-method': 'POST' },
      origin
    )
  ).toBe(false);
  expect(
    allowedPublicHomePreflight(
      { ...headers, 'access-control-request-headers': 'x-private' },
      origin
    )
  ).toBe(false);
  expect(publicHomeRpcCors(origin)['access-control-allow-origin']).toBe(origin);
});
