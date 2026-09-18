import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IdleBootReason } from '@/lib/posthog/schedule-idle-boot';

let pathname = '/';

const mocks = vi.hoisted(() => ({
  hasPostHogBrowserInitialized: vi.fn(() => false),
  initializePostHogBrowser: vi.fn(),
  initializePostHogInstrumentationIfAllowed: vi.fn(),
  scheduleIdleBoot: vi.fn(
    (_callback: (reason?: IdleBootReason) => void) => () => undefined
  ),
  waitForLcpWindowEnd: vi.fn(async () => undefined),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
}));

vi.mock('@/instrumentation-client', () => ({
  initializePostHogInstrumentationIfAllowed:
    mocks.initializePostHogInstrumentationIfAllowed,
}));

vi.mock('@/lib/posthog/browser-state', () => ({
  hasPostHogBrowserInitialized: mocks.hasPostHogBrowserInitialized,
}));

vi.mock('@/lib/posthog/browser', () => ({
  initializePostHogBrowser: mocks.initializePostHogBrowser,
}));

// The idle-boot mechanics (requestIdleCallback / load / first interaction /
// timeout) are covered in schedule-idle-boot.test.ts. Here the helper is mocked
// so the deferred boot only fires when the test explicitly triggers it, making
// boot timing deterministic instead of racing the real idle scheduler.
vi.mock('@/lib/posthog/schedule-idle-boot', () => ({
  scheduleIdleBoot: mocks.scheduleIdleBoot,
}));

// The LCP gate (PerformanceObserver / timeout) is covered in
// wait-for-lcp.test.ts. Here it resolves immediately so boot timing stays
// deterministic under jsdom, which never emits LCP entries. Hoisted into
// `mocks` so tests can assert whether the boot waited for LCP at all.
vi.mock('@/lib/posthog/wait-for-lcp', () => ({
  waitForLcpWindowEnd: mocks.waitForLcpWindowEnd,
}));

function importPostHogClientBootstrap() {
  return import('./posthog-client-bootstrap');
}

/**
 * Runs the callback the component handed to the (mocked) idle-boot
 * scheduler, simulating the given idle-boot trigger reason.
 */
function fireDeferredBoot(reason?: IdleBootReason) {
  const calls = mocks.scheduleIdleBoot.mock.calls;
  const scheduledBoot = calls[calls.length - 1]?.[0];
  scheduledBoot?.(reason);
}

afterEach(() => {
  pathname = '/';
  vi.clearAllMocks();
  mocks.hasPostHogBrowserInitialized.mockReset();
  mocks.hasPostHogBrowserInitialized.mockReturnValue(false);
  mocks.scheduleIdleBoot.mockImplementation(() => () => undefined);
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('PostHogClientBootstrap navigation', () => {
  it('waits for the first LCP candidate before booting on idle', async () => {
    vi.stubGlobal('location', { pathname: '/', href: 'https://usebaci.com/' });
    const { PostHogClientBootstrap } = await importPostHogClientBootstrap();

    render(<PostHogClientBootstrap />);

    fireDeferredBoot('idle');

    await vi.waitFor(() => {
      expect(mocks.initializePostHogBrowser).toHaveBeenCalledOnce();
    });
    expect(mocks.waitForLcpWindowEnd).toHaveBeenCalledOnce();
  });

  it('skips the LCP wait when the boot is triggered by an early interaction', async () => {
    // An early pointer/key interaction means the shopper is already engaging:
    // booting must not wait out the LCP window, or autocapture installs too
    // late and the follow-up clicks are lost (user events are not buffered).
    vi.stubGlobal('location', { pathname: '/', href: 'https://usebaci.com/' });
    const { PostHogClientBootstrap } = await importPostHogClientBootstrap();

    render(<PostHogClientBootstrap />);

    fireDeferredBoot('interaction');

    await vi.waitFor(() => {
      expect(mocks.initializePostHogBrowser).toHaveBeenCalledOnce();
    });
    expect(mocks.waitForLcpWindowEnd).not.toHaveBeenCalled();
    expect(
      mocks.initializePostHogInstrumentationIfAllowed
    ).toHaveBeenCalledWith('/');
  });

  it('suppresses a stale boot that resumes on a blog route after navigation', async () => {
    // An idle-triggered boot starts on a non-blog route, then the shopper
    // navigates to a public blog route while the LCP wait pends. The stale
    // invocation must re-resolve the route and stay off the full client.
    pathname = '/ogabassey/laptops/macbook-pro';
    vi.stubGlobal('location', {
      pathname,
      href: 'https://usebaci.com/ogabassey/laptops/macbook-pro',
      hostname: 'usebaci.com',
    });
    let resolveLcpWindow: () => void = () => undefined;
    mocks.waitForLcpWindowEnd.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveLcpWindow = () => resolve(undefined);
        })
    );
    const { PostHogClientBootstrap } = await importPostHogClientBootstrap();

    const { rerender } = render(<PostHogClientBootstrap />);

    fireDeferredBoot('idle');
    expect(mocks.waitForLcpWindowEnd).toHaveBeenCalledOnce();
    expect(mocks.initializePostHogBrowser).not.toHaveBeenCalled();

    pathname = '/ogabassey/blog/phone-guide';
    vi.stubGlobal('location', {
      pathname,
      href: 'https://usebaci.com/ogabassey/blog/phone-guide',
      hostname: 'usebaci.com',
    });
    rerender(<PostHogClientBootstrap />);

    resolveLcpWindow();
    // Macrotask flush: the suppression path has no dynamic imports, so the
    // resumed boot settles before this timer fires — the assertions below
    // cannot pass vacuously on a still-pending boot.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mocks.initializePostHogBrowser).not.toHaveBeenCalled();
    expect(
      mocks.initializePostHogInstrumentationIfAllowed
    ).not.toHaveBeenCalled();
  });

  it('schedules the idle boot once and never reschedules across client navigations', async () => {
    pathname = '/ogabassey/laptops/macbook-pro';
    vi.stubGlobal('location', {
      pathname,
      href: 'https://usebaci.com/ogabassey/laptops/macbook-pro',
      hostname: 'usebaci.com',
    });
    const { PostHogClientBootstrap } = await importPostHogClientBootstrap();

    const { rerender } = render(<PostHogClientBootstrap />);

    expect(mocks.scheduleIdleBoot).toHaveBeenCalledOnce();

    for (const nextPath of [
      '/ogabassey/phones/pixel',
      '/ogabassey/tablets/ipad',
    ]) {
      pathname = nextPath;
      vi.stubGlobal('location', {
        pathname,
        href: `https://usebaci.com${nextPath}`,
        hostname: 'usebaci.com',
      });
      rerender(<PostHogClientBootstrap />);
    }

    // A client navigation no longer cancels + reschedules the idle listeners:
    // the boot is armed exactly once at mount.
    expect(mocks.scheduleIdleBoot).toHaveBeenCalledOnce();
  });

  it('initializes PostHog after a client navigation from blog to a non-blog page', async () => {
    pathname = '/ogabassey/blog/phone-guide';
    vi.stubGlobal('location', {
      pathname,
      href: 'https://usebaci.com/ogabassey/blog/phone-guide',
      hostname: 'usebaci.com',
    });
    const { PostHogClientBootstrap } = await importPostHogClientBootstrap();

    const { rerender } = render(<PostHogClientBootstrap />);

    // Mount-once: the idle boot is scheduled at mount even on a blog path.
    expect(mocks.scheduleIdleBoot).toHaveBeenCalledOnce();

    // Firing the idle boot while still on the blog path stays off the full
    // client (the blog gate suppresses it).
    fireDeferredBoot();
    expect(mocks.initializePostHogBrowser).not.toHaveBeenCalled();

    pathname = '/ogabassey/laptops/macbook-pro';
    vi.stubGlobal('location', {
      pathname,
      href: 'https://usebaci.com/ogabassey/laptops/macbook-pro',
      hostname: 'usebaci.com',
    });
    rerender(<PostHogClientBootstrap />);

    // No reschedule on navigation — still exactly one scheduleIdleBoot call —
    // but the pathname-keyed effect boots immediately now that idle has elapsed.
    expect(mocks.scheduleIdleBoot).toHaveBeenCalledOnce();

    await vi.waitFor(() => {
      expect(mocks.initializePostHogBrowser).toHaveBeenCalledOnce();
    });
    expect(mocks.initializePostHogBrowser).toHaveBeenLastCalledWith(
      expect.objectContaining({
        NODE_ENV: expect.any(String),
      }),
      console,
      {
        lightweight: false,
        pathname: '/ogabassey/laptops/macbook-pro',
        hostname: 'usebaci.com',
      }
    );
    expect(
      mocks.initializePostHogInstrumentationIfAllowed
    ).toHaveBeenCalledWith('/ogabassey/laptops/macbook-pro');
  });

  it('skips the LCP wait when the client is already initialized', async () => {
    // Client-side navigations after boot must not re-pay the LCP settle
    // delay: the heavy chunk is cached and the settled document has no LCP
    // left to protect — re-waiting would only delay instrumentation.
    mocks.hasPostHogBrowserInitialized.mockReturnValue(true);
    vi.stubGlobal('location', { pathname: '/', href: 'https://usebaci.com/' });
    const { PostHogClientBootstrap } = await importPostHogClientBootstrap();

    render(<PostHogClientBootstrap />);

    fireDeferredBoot('idle');

    await vi.waitFor(() => {
      expect(mocks.initializePostHogBrowser).toHaveBeenCalledOnce();
    });
    expect(mocks.waitForLcpWindowEnd).not.toHaveBeenCalled();
  });
});
