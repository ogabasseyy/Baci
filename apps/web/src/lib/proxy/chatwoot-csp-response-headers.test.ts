import { NextRequest, NextResponse } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySecurityHeaders } from './response-headers';

describe('Chatwoot CSP response wiring', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('scopes HTTPS and WebSocket sources to the bound storefront hostname', () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    vi.stubEnv('EKAETTE_CHATWOOT_WIDGET_ENABLED', 'true');
    vi.stubEnv(
      'EKAETTE_CHATWOOT_PLATFORM_ORIGIN',
      'https://support.example.com'
    );
    vi.stubEnv(
      'EKAETTE_CHATWOOT_CONTEXT_BINDINGS',
      JSON.stringify([
        {
          merchantId: '11111111-1111-4111-8111-111111111111',
          origin: 'https://shop.example.com',
          websiteToken: 'public-widget-token-123456',
          inboxId: 42,
        },
      ])
    );

    const bound = applySecurityHeaders(
      NextResponse.next(),
      '/',
      'Mozilla',
      'storefront',
      false,
      undefined,
      new NextRequest('https://shop.example.com/'),
      'shop.example.com'
    );
    const unbound = applySecurityHeaders(
      NextResponse.next(),
      '/',
      'Mozilla',
      'storefront',
      false,
      undefined,
      new NextRequest('https://other.example.com/'),
      'other.example.com'
    );

    expect(bound.headers.get('Content-Security-Policy')).toContain(
      'https://support.example.com'
    );
    expect(bound.headers.get('Content-Security-Policy')).toContain(
      'wss://support.example.com'
    );
    expect(unbound.headers.get('Content-Security-Policy')).not.toContain(
      'https://support.example.com'
    );
    expect(unbound.headers.get('Content-Security-Policy')).not.toContain(
      'wss://support.example.com'
    );
  });

  it('omits Chatwoot sources when tenant bindings are ambiguous', () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    vi.stubEnv('EKAETTE_CHATWOOT_WIDGET_ENABLED', 'true');
    vi.stubEnv(
      'EKAETTE_CHATWOOT_PLATFORM_ORIGIN',
      'https://support.example.com'
    );
    vi.stubEnv(
      'EKAETTE_CHATWOOT_CONTEXT_BINDINGS',
      JSON.stringify([
        {
          merchantId: '11111111-1111-4111-8111-111111111111',
          origin: 'https://shop.example.com',
          websiteToken: 'public-widget-token-shared',
          inboxId: 41,
        },
        {
          merchantId: '22222222-2222-4222-8222-222222222222',
          origin: 'https://shop.example.com',
          websiteToken: 'public-widget-token-shared',
          inboxId: 42,
        },
      ])
    );

    const response = applySecurityHeaders(
      NextResponse.next(),
      '/',
      'Mozilla',
      'storefront',
      false,
      undefined,
      new NextRequest('https://shop.example.com/'),
      'shop.example.com'
    );

    expect(response.headers.get('Content-Security-Policy')).not.toContain(
      'https://support.example.com'
    );
  });
});
