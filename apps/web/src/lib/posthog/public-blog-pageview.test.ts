import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  capturePublicBlogPageview,
  resetPublicBlogPageviewDedupe,
  resetPublicBlogPageviewDedupeForTests,
} from './public-blog-pageview';

function parseFetchBody(fetch: ReturnType<typeof vi.fn>, index = 0) {
  const init = fetch.mock.calls[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

function stubStorage(initialEntries: Record<string, string> = {}) {
  const storage = new Map(
    Object.entries({
      'baci-cookie-consent': '{"analytics":true}',
      ...initialEntries,
    })
  );
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  return storage;
}

afterEach(() => {
  resetPublicBlogPageviewDedupeForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('capturePublicBlogPageview transport', () => {
  it('sends a tiny direct PostHog pageview beacon through the relay event endpoint', () => {
    const sendBeacon = vi.fn<typeof navigator.sendBeacon>(() => true);

    stubStorage();
    vi.stubGlobal('navigator', { sendBeacon, userAgent: 'Mozilla/5.0' });
    vi.stubGlobal('crypto', { randomUUID: () => 'visitor-1' });
    vi.stubGlobal('location', { origin: 'https://ogabassey.com' });

    capturePublicBlogPageview(
      {
        NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_public',
        NEXT_PUBLIC_POSTHOG_PROXY_PATH: '/baci-relay',
      },
      'https://ogabassey.com/blog?page=2#posts'
    );

    expect(sendBeacon).toHaveBeenCalledOnce();
    const firstCall = sendBeacon.mock.calls[0] as Parameters<
      typeof navigator.sendBeacon
    >;
    expect(firstCall[0]).toBe('/baci-relay/i/v0/e/');
    expect(firstCall[1]).toBeInstanceOf(Blob);
    expect((firstCall[1] as Blob).type).toBe('application/json');
  });

  it('falls back to keepalive fetch with JSON content type and tenant context', () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(new Response(null))
    );

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('location', { origin: 'https://usebaci.com' });
    stubStorage({
      ph_ph_public_posthog: JSON.stringify({ distinct_id: 'sdk-visitor-1' }),
    });

    capturePublicBlogPageview(
      {
        NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_public',
        NEXT_PUBLIC_ROOT_DOMAIN: 'usebaci.com',
      },
      'https://usebaci.com/ogabassey/blog/post?email=buyer@example.com'
    );

    expect(fetch).toHaveBeenCalledWith('/baci-relay/i/v0/e/', {
      body: expect.stringContaining('public_blog_lightweight'),
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      method: 'POST',
    });
    expect(parseFetchBody(fetch)).toMatchObject({
      api_key: 'ph_public',
      event: '$pageview',
      distinct_id: 'sdk-visitor-1',
      properties: {
        $current_url: 'https://usebaci.com/ogabassey/blog/post',
        $host: 'usebaci.com',
        $pathname: '/ogabassey/blog/post',
        $process_person_profile: false,
        app_surface: 'web',
        capture_mode: 'public_blog_lightweight',
        distinct_id: 'sdk-visitor-1',
        merchant_slug: 'ogabassey',
        token: 'ph_public',
      },
    });
  });

  it('falls back to keepalive fetch when sendBeacon rejects or declines the payload', () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(new Response(null))
    );
    const env = { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_public' };

    stubStorage({
      ph_ph_public_posthog: JSON.stringify({ distinct_id: 'sdk-visitor-1' }),
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('location', { origin: 'https://ogabassey.com' });
    vi.stubGlobal('navigator', {
      sendBeacon: vi.fn<typeof navigator.sendBeacon>(() => {
        throw new DOMException('Beacon payload type rejected');
      }),
      userAgent: 'Mozilla/5.0',
    });

    capturePublicBlogPageview(env, 'https://ogabassey.com/blog');

    vi.stubGlobal('navigator', {
      sendBeacon: vi.fn<typeof navigator.sendBeacon>(() => false),
      userAgent: 'Mozilla/5.0',
    });
    capturePublicBlogPageview(env, 'https://ogabassey.com/blog/post');

    expect(fetch).toHaveBeenCalledTimes(2);
    for (const call of fetch.mock.calls) {
      expect(call).toEqual([
        '/baci-relay/i/v0/e/',
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          method: 'POST',
        }),
      ]);
    }
  });

  it('does nothing without a public project token or when called with defaults outside a browser URL', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    capturePublicBlogPageview({}, 'https://ogabassey.com/blog');
    capturePublicBlogPageview();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not send likely bot pageviews through the direct capture path', () => {
    stubStorage();
    const sendBeacon = vi.fn<typeof navigator.sendBeacon>(() => true);

    vi.stubGlobal('navigator', {
      sendBeacon,
      userAgent: 'Mozilla/5.0 Chrome-Lighthouse',
    });

    capturePublicBlogPageview(
      { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_public' },
      'https://ogabassey.com/blog'
    );

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('keeps query-only navigations observable while redacting query values', () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(new Response(null))
    );
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('location', { origin: 'https://ogabassey.com' });
    stubStorage();

    const env = { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_public' };
    capturePublicBlogPageview(env, 'https://ogabassey.com/blog?page=1');
    capturePublicBlogPageview(env, 'https://ogabassey.com/blog?page=2');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect([parseFetchBody(fetch, 0), parseFetchBody(fetch, 1)]).toEqual([
      expect.objectContaining({
        properties: expect.objectContaining({
          $current_url: 'https://ogabassey.com/blog',
        }),
      }),
      expect.objectContaining({
        properties: expect.objectContaining({
          $current_url: 'https://ogabassey.com/blog',
        }),
      }),
    ]);
  });

  it('deduplicates exact repeated blog pageviews until the route context resets', () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(new Response(null))
    );
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('location', { origin: 'https://ogabassey.com' });
    stubStorage();

    const env = { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_public' };
    capturePublicBlogPageview(env, 'https://ogabassey.com/blog');
    capturePublicBlogPageview(env, 'https://ogabassey.com/blog');
    resetPublicBlogPageviewDedupe();
    capturePublicBlogPageview(env, 'https://ogabassey.com/blog');

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('parses relative URLs with a safe non-browser base', () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(new Response(null))
    );
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('crypto', { randomUUID: () => 'relative-url-id' });
    vi.stubGlobal('location', undefined);
    stubStorage();

    capturePublicBlogPageview(
      { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_public' },
      '/ogabassey/blog?query=redmi'
    );

    expect(parseFetchBody(fetch)).toMatchObject({
      properties: {
        $current_url: 'https://usebaci.com/ogabassey/blog',
        $host: 'usebaci.com',
        $pathname: '/ogabassey/blog',
      },
    });
  });
});
