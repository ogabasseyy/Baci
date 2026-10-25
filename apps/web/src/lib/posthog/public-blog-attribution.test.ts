import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  capturePublicBlogPageview,
  resetPublicBlogPageviewDedupeForTests,
} from './public-blog-pageview';

const env = { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_public' };
let fetch: ReturnType<typeof vi.fn>;
let storage: Map<string, string>;
function properties(index = 0): Record<string, unknown> {
  return JSON.parse(String(fetch.mock.calls[index]?.[1]?.body)).properties;
}
function referrer(value: string) {
  vi.stubGlobal('document', { referrer: value });
}
beforeEach(() => {
  fetch = vi.fn(async () => new Response(null));
  storage = new Map([
    ['baci-cookie-consent', JSON.stringify({ analytics: true })],
  ]);
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0' });
  vi.stubGlobal('location', { origin: 'https://ogabassey.com' });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  referrer('');
});
afterEach(() => {
  resetPublicBlogPageviewDedupeForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('lightweight blog acquisition payload', () => {
  it.each([
    'www.google.com',
    'chatgpt.com',
    'www.perplexity.ai',
  ])('captures only the external origin and domain for %s', (domain) => {
    referrer(`https://${domain}/private/person?email=buyer@example.com#secret`);
    capturePublicBlogPageview(env, 'https://ogabassey.com/blog/post');
    expect(fetch).toHaveBeenCalledOnce();
    expect(properties()).toMatchObject({
      $referrer: `https://${domain}`,
      $referring_domain: domain,
    });
    expect(JSON.stringify(properties())).not.toMatch(/private|buyer|secret/);
  });
  it.each([
    '',
    'https://ogabassey.com/account/private',
    'javascript:secret',
    'invalid',
    'https://buyer:secret@google.com/',
  ])('treats missing, internal or unsafe referrer %s as direct/unknown', (value) => {
    referrer(value);
    capturePublicBlogPageview(env, 'https://ogabassey.com/blog');
    expect(properties()).toMatchObject({
      $referrer: '$direct',
      $referring_domain: '$direct',
    });
  });
  it('keeps allowlisted campaign tokens without leaking URL queries or personal fields', () => {
    capturePublicBlogPageview(
      env,
      'https://ogabassey.com/blog?utm_source=google&utm_medium=cpc&utm_campaign=october-sale&utm_term=buyer@example.com&utm_content=private&gclid=secret&email=buyer@example.com#secret'
    );
    expect(properties()).toMatchObject({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'october-sale',
      $current_url: 'https://ogabassey.com/blog',
    });
    expect(properties()).not.toHaveProperty('utm_term');
    expect(properties()).not.toHaveProperty('utm_content');
    expect(JSON.stringify(properties())).not.toMatch(
      /secret|buyer|private|gclid/
    );
  });
  it.each([
    'buyer@example.com',
    '+2348012345678',
    'hello world',
    'https://example.com/private',
    'a'.repeat(81),
    'campaign-08012345678',
  ])('drops unsafe campaign value %s', (value) => {
    capturePublicBlogPageview(
      env,
      `https://ogabassey.com/blog?utm_campaign=${encodeURIComponent(value)}`
    );
    expect(properties()).not.toHaveProperty('utm_campaign');
  });
  it('preserves first observed document acquisition across SPA views and deduplicates repeats', () => {
    referrer('https://chatgpt.com/c/private');
    const landing =
      'https://ogabassey.com/blog/a?utm_source=chatgpt&utm_campaign=guide';
    capturePublicBlogPageview(env, landing);
    capturePublicBlogPageview(env, landing);
    capturePublicBlogPageview(
      env,
      'https://ogabassey.com/blog/b?utm_source=internal'
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(properties(1)).toMatchObject({
      $referrer: 'https://chatgpt.com',
      $referring_domain: 'chatgpt.com',
      utm_source: 'chatgpt',
      utm_campaign: 'guide',
      $pathname: '/blog/b',
    });
    expect(properties(1)).not.toHaveProperty('$session_id');
  });
  it.each([
    undefined,
    '{broken',
    '{"analytics":false}',
  ])('does not send or persist an identity without consent %s', (consent) => {
    storage.delete('baci-cookie-consent');
    if (consent) storage.set('baci-cookie-consent', consent);
    capturePublicBlogPageview(env, 'https://ogabassey.com/blog');
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.has('ph_ph_public_posthog')).toBe(false);
    storage.set('baci-cookie-consent', '{"analytics":true}');
    capturePublicBlogPageview(env, 'https://ogabassey.com/blog');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('honors an explicit PostHog SDK opt-out', () => {
    storage.set('__ph_opt_in_out_ph_public', '0');
    capturePublicBlogPageview(env, 'https://ogabassey.com/blog');
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.has('ph_ph_public_posthog')).toBe(false);
  });
  it.each([
    'false',
    'no',
  ])('honors SDK-compatible opt-out value %s', (value) => {
    storage.set('__ph_opt_in_out_ph_public', value);
    capturePublicBlogPageview(env, 'https://ogabassey.com/blog');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('honors cookie-persisted opt-out before sending or storing identity', () => {
    vi.stubGlobal('document', {
      referrer: '',
      cookie: '__ph_opt_in_out_ph_public=0',
    });
    capturePublicBlogPageview(env, 'https://ogabassey.com/blog');
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.has('ph_ph_public_posthog')).toBe(false);
  });
});
