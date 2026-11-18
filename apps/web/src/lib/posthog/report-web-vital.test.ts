// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogWebVitalsPayload } from './web-vitals-queue';

const mocks = vi.hoisted(() => ({
  hasPostHogBrowserInitialized: vi.fn(() => false),
  capturePostHogWebVitals: vi.fn(),
  enqueuePostHogWebVital: vi.fn(),
}));

vi.mock('@/lib/posthog/browser-state', () => ({
  hasPostHogBrowserInitialized: mocks.hasPostHogBrowserInitialized,
}));

vi.mock('@/lib/posthog/browser', () => ({
  capturePostHogWebVitals: mocks.capturePostHogWebVitals,
}));

vi.mock('@/lib/posthog/web-vitals-queue', () => ({
  enqueuePostHogWebVital: mocks.enqueuePostHogWebVital,
}));

function importReporter() {
  return import('./report-web-vital');
}

function buildPayload(
  overrides: Partial<PostHogWebVitalsPayload> = {}
): PostHogWebVitalsPayload {
  return {
    metric: 'TTFB',
    value: 120,
    rating: 'good',
    navigationType: 'navigate',
    pathname: '/dashboard',
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('location', {
    pathname: '/dashboard',
    hostname: 'ogabassey.com',
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('reportPostHogWebVital', () => {
  it('captures immediately through the browser client once PostHog has booted', async () => {
    // Arrange
    mocks.hasPostHogBrowserInitialized.mockReturnValue(true);
    const payload = buildPayload();
    const { reportPostHogWebVital } = await importReporter();

    // Act
    reportPostHogWebVital(payload);

    // Assert
    await vi.waitFor(() => {
      expect(mocks.capturePostHogWebVitals).toHaveBeenCalledWith(payload);
    });
    expect(mocks.enqueuePostHogWebVital).not.toHaveBeenCalled();
  });

  it('buffers the metric when PostHog has not booted on an eligible page', async () => {
    // Arrange
    mocks.hasPostHogBrowserInitialized.mockReturnValue(false);
    const payload = buildPayload();
    const { reportPostHogWebVital } = await importReporter();

    // Act
    reportPostHogWebVital(payload);

    // Assert
    expect(mocks.enqueuePostHogWebVital).toHaveBeenCalledWith(payload);
    expect(mocks.capturePostHogWebVitals).not.toHaveBeenCalled();
  });

  it('drops pre-boot metrics on public blog surfaces instead of buffering them', async () => {
    // Arrange
    mocks.hasPostHogBrowserInitialized.mockReturnValue(false);
    const payload = buildPayload({ pathname: '/blog/phone-guide' });
    const { reportPostHogWebVital } = await importReporter();

    // Act
    reportPostHogWebVital(payload);

    // Assert
    expect(mocks.enqueuePostHogWebVital).not.toHaveBeenCalled();
    expect(mocks.capturePostHogWebVitals).not.toHaveBeenCalled();
  });

  it('does nothing without a browser window', async () => {
    // Arrange
    mocks.hasPostHogBrowserInitialized.mockReturnValue(false);
    vi.stubGlobal('window', undefined);
    const { reportPostHogWebVital } = await importReporter();

    // Act
    reportPostHogWebVital(buildPayload());

    // Assert
    expect(mocks.enqueuePostHogWebVital).not.toHaveBeenCalled();
    expect(mocks.capturePostHogWebVitals).not.toHaveBeenCalled();
  });
});
