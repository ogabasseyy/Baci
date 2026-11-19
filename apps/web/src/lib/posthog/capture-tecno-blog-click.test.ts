// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureTecnoBlogClick } from './capture-tecno-blog-click';

function stubStorage(overrides: Record<string, string> = {}) {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: false,
      ...JSON.parse(overrides['baci-cookie-consent'] ?? '{}'),
    })
  );
}

function parseFetchBody(fetch: ReturnType<typeof vi.fn>, index: number) {
  const init = fetch.mock.calls[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('TECNO sponsored CTA capture', () => {
  const page =
    'https://ogabassey.com/blog/tecno-camon-slim-iphone-instant-transfer-sponsored';
  const env = { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_public' };

  it('records two distinct clicks without blocking navigation or leaking the page query', () => {
    stubStorage();
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });
    const fetch = vi.fn(async () => new Response(null));
    vi.stubGlobal('fetch', fetch);

    captureTecnoBlogClick(
      'https://www.tecno-mobile.com/nga/phones/product-detail/product/camon-slim/?utm_content=learn_more',
      env,
      `${page}?email=private@example.com`
    );
    captureTecnoBlogClick(
      'https://ng-store.tecno.com/?utm_content=order_here',
      env,
      page
    );
    captureTecnoBlogClick(
      'https://other.example/?utm_content=order_here',
      env,
      page
    );
    captureTecnoBlogClick(
      'https://ng-store.tecno.com/?utm_content=order_here',
      env,
      `${page}-other`
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(parseFetchBody(fetch, 0)).toMatchObject({
      event: 'tecno_camon_slim_learn_more_clicked',
      properties: { $current_url: page },
    });
    expect(parseFetchBody(fetch, 1)).toMatchObject({
      event: 'tecno_camon_slim_order_here_clicked',
      properties: { $current_url: page },
    });
  });

  it('normalizes trailing slashes and utm_content casing on canonical visits', () => {
    stubStorage();
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });
    const fetch = vi.fn(async () => new Response(null));
    vi.stubGlobal('fetch', fetch);

    captureTecnoBlogClick(
      'https://www.tecno-mobile.com/nga/phones/product-detail/product/camon-slim?utm_content=LEARN_MORE',
      env,
      `${page}/`
    );
    captureTecnoBlogClick(
      'HTTPS://NG-STORE.TECNO.COM?utm_content=Order_Here',
      env,
      page
    );
    captureTecnoBlogClick(
      'https://ng-store.tecno.com/?utm_content=order_here',
      env,
      'https://ogabassey.usebaci.com/blog/tecno-camon-slim-iphone-instant-transfer-sponsored'
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(parseFetchBody(fetch, 0)).toMatchObject({
      event: 'tecno_camon_slim_learn_more_clicked',
    });
    expect(parseFetchBody(fetch, 1)).toMatchObject({
      event: 'tecno_camon_slim_order_here_clicked',
    });
  });

  it('does not send clicks without analytics consent', () => {
    stubStorage({
      'baci-cookie-consent': JSON.stringify({ analytics: false }),
    });
    const sendBeacon = vi.fn(() => true);
    const fetch = vi.fn(async () => new Response(null));
    vi.stubGlobal('navigator', { sendBeacon, userAgent: 'Mozilla/5.0' });
    vi.stubGlobal('fetch', fetch);
    captureTecnoBlogClick(
      'https://ng-store.tecno.com/?utm_content=order_here',
      env,
      page
    );
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
