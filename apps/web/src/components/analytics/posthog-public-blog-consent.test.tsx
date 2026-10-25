import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPublicBlogPageviewDedupeForTests } from '@/lib/posthog/public-blog-pageview';
import { PostHogPageviewTracker } from './posthog-pageview-tracker';

let pathname = '/ogabassey/blog/guide';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@/lib/posthog/browser-state', () => ({
  hasPostHogBrowserInitialized: () => false,
}));
vi.mock('@/lib/posthog/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog/config')>()),
  getPostHogBrowserEnv: () => ({
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_public',
  }),
}));
let fetch: ReturnType<typeof vi.fn>;
function consent(analytics: boolean) {
  localStorage.setItem('baci-cookie-consent', JSON.stringify({ analytics }));
  act(() => {
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
}
beforeEach(() => {
  pathname = '/ogabassey/blog/guide';
  window.history.replaceState(
    null,
    '',
    `${pathname}?utm_source=google&utm_campaign=guide`
  );
  localStorage.clear();
  fetch = vi.fn(async () => new Response(null));
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(document, 'referrer', 'get').mockReturnValue(
    'https://www.google.com/private?q=secret'
  );
});
afterEach(() => {
  resetPublicBlogPageviewDedupeForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
describe('lightweight blog consent lifecycle', () => {
  it('captures the current landing exactly once after consent, and removes its listener on unmount', () => {
    const { unmount } = render(<PostHogPageviewTracker />);
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem('ph_ph_public_posthog')).toBeNull();
    consent(true);
    consent(true);
    expect(fetch).toHaveBeenCalledOnce();
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.properties).toMatchObject({
      $referrer: 'https://www.google.com',
      utm_source: 'google',
      utm_campaign: 'guide',
    });
    expect(JSON.stringify(payload)).not.toMatch(/secret|private|\?/);
    unmount();
    consent(false);
    consent(true);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('replaces the route listener and stops sending while consent is withdrawn', () => {
    const { rerender } = render(<PostHogPageviewTracker />);
    consent(true);
    consent(false);
    pathname = '/ogabassey/blog/next';
    window.history.pushState(null, '', pathname);
    rerender(<PostHogPageviewTracker />);
    expect(fetch).toHaveBeenCalledOnce();
    consent(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body).properties.$pathname).toBe(
      pathname
    );
    consent(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
