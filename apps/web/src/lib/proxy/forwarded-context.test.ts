import { NextRequest, type NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import { buildFinalProxyResponse } from './final-response';
import { ROOT_DOMAIN } from './host';
import { runPlatformRoutingStage } from './platform-routing';

function requestFor(path: string): NextRequest {
  return new NextRequest(`https://${ROOT_DOMAIN}${path}`, {
    headers: {
      'x-merchant-slug': 'forged-merchant',
      'x-custom-domain': 'forged.example',
      'x-merchant-domain': 'forged.example',
      'accept-language': 'en-NG',
    },
  });
}

function expectSanitized(response: NextResponse | null): void {
  expect(response).not.toBeNull();
  // A next/rewrite with no request override leaves original client headers intact.
  const overrides = response?.headers.get('x-middleware-override-headers');
  expect(overrides).toBeTruthy();
  for (const name of [
    'x-merchant-slug',
    'x-custom-domain',
    'x-merchant-domain',
  ]) {
    expect(overrides?.split(',')).not.toContain(name);
    expect(response?.headers.get(`x-middleware-request-${name}`)).toBeNull();
  }
  expect(response?.headers.get('x-middleware-request-accept-language')).toBe(
    'en-NG'
  );
}

describe('untrusted forwarded merchant context', () => {
  it.each([
    '/dashboard',
    '/login',
    '/',
    '/api/example',
  ])('scrubs client context from final response for %s', (path) => {
    const request = requestFor(path);
    expectSanitized(
      buildFinalProxyResponse(request, path, ROOT_DOMAIN, 'Mozilla')
    );
  });

  it.each([
    '/.well-known/example',
    '/llms.txt',
    '/about.md',
  ])('scrubs client context from platform pass-through/rewrite for %s', async (path) => {
    expectSanitized(
      await runPlatformRoutingStage(
        requestFor(path),
        path,
        ROOT_DOMAIN,
        'Mozilla'
      )
    );
  });
});
