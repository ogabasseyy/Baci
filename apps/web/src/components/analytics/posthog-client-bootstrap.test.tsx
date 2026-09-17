import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let pathname = '/';

const mocks = vi.hoisted(() => ({
  hasPostHogBrowserInitialized: vi.fn(() => false),
  initializePostHogBrowser: vi.fn(),
  initializePostHogInstrumentationIfAllowed: vi.fn(),
  scheduleIdleBoot: vi.fn((_callback: () => void) => () => undefined),
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
// deterministic under jsdom, which never emits LCP entries.
vi.mock('@/lib/posthog/wait-for-lcp', () => ({
  waitForFirstLcpCandidate: vi.fn(async () => undefined),
}));

function importPostHogClientBootstrap() {
  return import('./posthog-client-bootstrap');
}

/** Runs the callback the component handed to the (mocked) idle-boot scheduler. */
function fireDeferredBoot() {
  const calls = mocks.scheduleIdleBoot.mock.calls;
  const scheduledBoot = calls[calls.length - 1]?.[0];
  scheduledBoot?.();
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

describe('PostHogClientBootstrap', () => {
  it('initializes PostHog after mount on non-blog pages', async () => {
    vi.stubGlobal('location', { pathname: '/', href: 'https://usebaci.com/' });
    const { PostHogClientBootstrap } = await importPostHogClientBootstrap();

    render(<PostHogClientBootstrap />);

    // The boot is deferred behind the idle scheduler, so it is not called during
    // mount — it fires only once the scheduled callback is triggered.
    expect(mocks.scheduleIdleBoot).toHaveBeenCalledOnce();
    expect(mocks.initializePostHogBrowser).not.toHaveBeenCalled();

    fireDeferredBoot();

    await vi.waitFor(() => {
      expect(mocks.initializePostHogBrowser).toHaveBeenCalledOnce();
    });

    expect(
      mocks.initializePostHogInstrumentationIfAllowed
    ).toHaveBeenCalledWith('/');
    expect(mocks.initializePostHogBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        NODE_ENV: expect.any(String),
      }),
      console,
      {
        lightweight: false,
        pathname: '/',
        hostname: undefined,
      }
    );
  });

  it('does not initialize the full PostHog browser client on initial public blog pages', async () => {
    pathname = '/ogabassey/blog/phone-guide';
    vi.stubGlobal('location', {
      pathname,
      href: 'https://usebaci.com/ogabassey/blog/phone-guide',
      hostname: 'usebaci.com',
    });
    const { PostHogClientBootstrap } = await importPostHogClientBootstrap();

    render(<PostHogClientBootstrap />);

    // The idle boot is scheduled once on mount (mount-once, no longer gated on
    // the pathname), but firing it stays off the full client on a blog path.
    expect(mocks.scheduleIdleBoot).toHaveBeenCalledOnce();

    fireDeferredBoot();

    // The blog gate short-circuits synchronously before any dynamic import.
    expect(mocks.initializePostHogBrowser).not.toHaveBeenCalled();
    expect(
      mocks.initializePostHogInstrumentationIfAllowed
    ).not.toHaveBeenCalled();
  });

  it('reconfigures an already initialized PostHog browser client on public blog pages', async () => {
    mocks.hasPostHogBrowserInitialized.mockReturnValue(true);
    pathname = '/ogabassey/blog/phone-guide';
    vi.stubGlobal('location', {
      pathname,
      href: 'https://usebaci.com/ogabassey/blog/phone-guide',
      hostname: 'usebaci.com',
    });
    const { PostHogClientBootstrap } = await importPostHogClientBootstrap();

    render(<PostHogClientBootstrap />);

    expect(mocks.scheduleIdleBoot).toHaveBeenCalledOnce();
    expect(mocks.initializePostHogBrowser).not.toHaveBeenCalled();

    fireDeferredBoot();

    await vi.waitFor(() => {
      expect(mocks.initializePostHogBrowser).toHaveBeenCalledOnce();
    });
    expect(mocks.initializePostHogBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        NODE_ENV: expect.any(String),
      }),
      console,
      {
        lightweight: true,
        pathname: '/ogabassey/blog/phone-guide',
        hostname: 'usebaci.com',
      }
    );
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
});
