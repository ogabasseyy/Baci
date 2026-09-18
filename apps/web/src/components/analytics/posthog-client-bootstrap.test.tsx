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
});
