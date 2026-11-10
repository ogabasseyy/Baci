import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  capturePublicBlogPageview,
  resetPublicBlogPageviewDedupeForTests,
} from './public-blog-pageview';

// Identity/storage fallback tests isolate consent; consent behavior has payload and tracker coverage.
vi.mock('@/lib/analytics-consent', () => ({ isAnalyticsAllowed: () => true }));

function parseFetchBody(fetch: ReturnType<typeof vi.fn>, index = 0) {
  const init = fetch.mock.calls[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

function stubStorage(initialEntries: Record<string, string> = {}) {
  const storage = new Map(Object.entries(initialEntries));
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

describe('capturePublicBlogPageview identity persistence', () => {
  it('seeds the PostHog SDK persistence key when no SDK distinct ID exists yet', () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(new Response(null))
    );
    const storage = stubStorage();

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('crypto', { randomUUID: () => 'generated-sdk-id' });
    vi.stubGlobal('location', { origin: 'https://ogabassey.com' });

    capturePublicBlogPageview(
      { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_public' },
      'https://ogabassey.com/blog'
    );

    expect(parseFetchBody(fetch)).toMatchObject({
      distinct_id: 'generated-sdk-id',
      properties: { distinct_id: 'generated-sdk-id' },
    });
    expect(JSON.parse(storage.get('ph_ph_public_posthog') ?? '{}')).toEqual(
      expect.objectContaining({
        $device_id: 'generated-sdk-id',
        distinct_id: 'generated-sdk-id',
      })
    );
  });

  it('uses the PostHog SDK device ID field when distinct ID is not persisted yet', () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(new Response(null))
    );
    const storage = stubStorage({
      ph_ph_public_posthog: JSON.stringify({ $device_id: 'sdk-device-1' }),
    });

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('location', { origin: 'https://ogabassey.com' });

    capturePublicBlogPageview(
      { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_public' },
      'https://ogabassey.com/blog'
    );

    expect(parseFetchBody(fetch)).toMatchObject({
      distinct_id: 'sdk-device-1',
      properties: { distinct_id: 'sdk-device-1' },
    });
    expect(JSON.parse(storage.get('ph_ph_public_posthog') ?? '{}')).toEqual(
      expect.objectContaining({
        $device_id: 'sdk-device-1',
        distinct_id: 'sdk-device-1',
      })
    );
  });

  it('migrates the legacy public blog distinct ID into SDK persistence', () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(new Response(null))
    );
    const storage = stubStorage({
      baci_public_blog_distinct_id: 'legacy-blog-id',
    });

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('location', { origin: 'https://ogabassey.com' });

    capturePublicBlogPageview(
      { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_public' },
      'https://ogabassey.com/blog'
    );

    expect(parseFetchBody(fetch)).toMatchObject({
      distinct_id: 'legacy-blog-id',
      properties: { distinct_id: 'legacy-blog-id' },
    });
    expect(JSON.parse(storage.get('ph_ph_public_posthog') ?? '{}')).toEqual(
      expect.objectContaining({
        $device_id: 'legacy-blog-id',
        distinct_id: 'legacy-blog-id',
      })
    );
  });

  it('reuses an in-memory fallback distinct ID when storage is blocked', () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(new Response(null))
    );

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('crypto', {
      randomUUID: vi
        .fn<() => `${string}-${string}-${string}-${string}-${string}`>()
        .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
        .mockReturnValueOnce('00000000-0000-4000-8000-000000000002'),
    });
    vi.stubGlobal('location', { origin: 'https://ogabassey.com' });
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });

    const env = { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_public' };
    capturePublicBlogPageview(env, 'https://ogabassey.com/blog');
    capturePublicBlogPageview(env, 'https://ogabassey.com/blog/post');

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(parseFetchBody(fetch, 0)).toMatchObject({
      distinct_id: '00000000-0000-4000-8000-000000000001',
      properties: { distinct_id: '00000000-0000-4000-8000-000000000001' },
    });
    expect(parseFetchBody(fetch, 1)).toMatchObject({
      distinct_id: '00000000-0000-4000-8000-000000000001',
      properties: { distinct_id: '00000000-0000-4000-8000-000000000001' },
    });
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce();
  });
});
