import { type NextRequest, NextResponse } from 'next/server';
import { runCustomDomainRouting } from '../../src/lib/proxy/custom-domain-routing';
import { buildFinalProxyResponse } from '../../src/lib/proxy/final-response';
import {
  getRequestSubdomain,
  runSubdomainRouting,
} from '../../src/lib/proxy/subdomain-routing';

export async function proxy(request: NextRequest) {
  if (
    request.nextUrl.pathname !== '/checkout' &&
    request.nextUrl.pathname !== '/trusted-shop/checkout'
  )
    return NextResponse.next();
  const fakeFetch: typeof fetch = (input) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    );
    if (url.pathname.endsWith('/token')) {
      const accessToken = `e30.${Buffer.from(JSON.stringify({ sub: 'synthetic-user', exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', fixturePadding: 'x'.repeat(request.nextUrl.searchParams.get('case') === 'large' ? 6000 : 1900) })).toString('base64url')}.sig`;
      return Promise.resolve(
        Response.json({
          access_token: accessToken,
          refresh_token: 'synthetic-refreshed-token',
          token_type: 'bearer',
          expires_in: 3600,
          user: {
            id: 'synthetic-user',
            aud: 'authenticated',
            role: 'authenticated',
          },
        })
      );
    }
    if (url.pathname.includes('/rest/v1/')) {
      const table = url.pathname.split('/').at(-1);
      const foreign = request.nextUrl.searchParams.get('case') === 'foreign';
      const data =
        table === 'orders'
          ? {
              id: '6974e8cc-4e90-4ca9-b2cf-aa2abaf461df',
              merchant_id: 'merchant',
              customer_id: 'customer',
              payment_method:
                request.nextUrl.searchParams.get('case') === 'non-oxygen'
                  ? 'paystack'
                  : 'oxygen',
            }
          : table === 'customers'
            ? {
                id: 'customer',
                merchant_id: 'merchant',
                user_id: foreign ? 'other' : 'synthetic-user',
              }
            : table === 'merchants'
              ? { id: 'merchant', slug: 'trusted-shop' }
              : null;
      return Promise.resolve(Response.json(data));
    }
    if (url.pathname.endsWith('/user'))
      return Promise.resolve(
        Response.json({
          id: 'synthetic-user',
          aud: 'authenticated',
          role: 'authenticated',
        })
      );
    return Promise.resolve(
      new Response('unexpected synthetic auth request', { status: 500 })
    );
  };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    const slug =
      request.nextUrl.searchParams.get('case') === 'wrong-merchant'
        ? 'wrong-shop'
        : 'trusted-shop';
    if (request.nextUrl.pathname === '/trusted-shop/checkout') {
      return await buildFinalProxyResponse(
        request,
        '/trusted-shop/checkout',
        'usebaci.com',
        'test'
      );
    }
    if (request.nextUrl.searchParams.get('mode') === 'subdomain') {
      const host = 'trusted-shop.localhost';
      return (
        (await runSubdomainRouting(
          request,
          '/checkout',
          host,
          'test',
          getRequestSubdomain(host)
        )) ?? NextResponse.next()
      );
    }
    return await runCustomDomainRouting(
      request,
      '/checkout',
      'shop.example.test',
      'test',
      {
        domain: 'shop.example.test',
        domainMerchantSlug: slug,
        domainPathSegments: ['checkout'],
        normalizedRequestHost: 'shop.example.test',
        requestHostHadWww: false,
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
}
export const config = { matcher: ['/checkout', '/trusted-shop/checkout'] };
