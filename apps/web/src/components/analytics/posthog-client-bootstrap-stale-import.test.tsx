import { act, render } from '@testing-library/react';
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

// Deferred browser chunk: the dynamic import pends until the test releases
// it, so a navigation can land mid-chunk deterministically. Vitest runs the
// mock factory once per file, so this module holds exactly one test.
const chunkRelease = vi.hoisted(() => ({
  release: null as (() => void) | null,
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

vi.mock('@/lib/posthog/browser', async () => {
  await new Promise<void>((resolve) => {
    chunkRelease.release = resolve;
  });
  return { initializePostHogBrowser: mocks.initializePostHogBrowser };
});

vi.mock('@/lib/posthog/schedule-idle-boot', () => ({
  scheduleIdleBoot: mocks.scheduleIdleBoot,
}));

vi.mock('@/lib/posthog/wait-for-lcp', () => ({
  waitForLcpWindowEnd: mocks.waitForLcpWindowEnd,
}));

function importPostHogClientBootstrap() {
  return import('./posthog-client-bootstrap');
}

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

describe('PostHogClientBootstrap deferred import', () => {
  it('drops a stale boot that navigates to a blog route while the browser chunk pends', async () => {
    // The exact race the post-import re-read guards: the idle boot starts
    // on a non-blog route, the browser chunk stalls, and the shopper
    // reaches a public blog before it resolves. The stale invocation must
    // not initialize the full client for the old route.
    pathname = '/ogabassey/laptops/macbook-pro';
    vi.stubGlobal('location', {
      pathname,
      href: 'https://usebaci.com/ogabassey/laptops/macbook-pro',
      hostname: 'usebaci.com',
    });
    const { PostHogClientBootstrap } = await importPostHogClientBootstrap();

    const { rerender } = render(<PostHogClientBootstrap />);

    fireDeferredBoot('idle');
    // Park the boot on the held chunk import (past the LCP wait and the
    // pre-import re-read, both mocked immediate).
    await vi.waitFor(() => {
      expect(chunkRelease.release).not.toBeNull();
    });
    expect(mocks.initializePostHogBrowser).not.toHaveBeenCalled();

    pathname = '/ogabassey/blog/phone-guide';
    vi.stubGlobal('location', {
      pathname,
      href: 'https://usebaci.com/ogabassey/blog/phone-guide',
      hostname: 'usebaci.com',
    });
    rerender(<PostHogClientBootstrap />);

    await act(async () => {
      chunkRelease.release?.();
      await Promise.resolve();
    });
    // Settle the resumed boot past both dynamic imports.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mocks.initializePostHogBrowser).not.toHaveBeenCalled();
    expect(
      mocks.initializePostHogInstrumentationIfAllowed
    ).not.toHaveBeenCalled();
  });
});
