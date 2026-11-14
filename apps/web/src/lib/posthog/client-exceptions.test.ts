// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postHogMocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  loadSdk: vi.fn(),
}));

vi.mock('@/lib/posthog/posthog-sdk-loader', () => ({
  loadPostHogBrowserSdk: postHogMocks.loadSdk,
}));

function getLoadedSdk() {
  return Promise.resolve({
    default: {
      captureException: postHogMocks.captureException,
    },
  });
}

describe('PostHog client exceptions', () => {
  const originalToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

  beforeEach(() => {
    vi.resetModules();
    window.sessionStorage.clear();
    postHogMocks.captureException.mockReset();
    postHogMocks.loadSdk.mockReset();
    postHogMocks.loadSdk.mockImplementation(getLoadedSdk);
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    } else {
      process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = originalToken;
    }
  });

  it('does not capture when the project token is missing', async () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    const { captureClientException } = await import(
      '@/lib/posthog/client-exceptions'
    );

    expect(captureClientException(new Error('missing token'))).toBe(false);
    // Flush any pending microtasks so a mistaken async import would surface.
    await Promise.resolve();
    expect(postHogMocks.captureException).not.toHaveBeenCalled();
  });

  it('defers the posthog-js SDK load until an exception is captured', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = 'ph_test';
    const { captureClientException } = await import(
      '@/lib/posthog/client-exceptions'
    );

    // Synchronous return signals capture was ATTEMPTED, but the SDK import (and
    // thus the actual capture) is deferred to a microtask — proving posthog-js
    // is not pulled onto the synchronous call path / initial graph.
    expect(captureClientException(new Error('deferred'))).toBe(true);
    expect(postHogMocks.captureException).not.toHaveBeenCalled();

    await vi.waitFor(() =>
      expect(postHogMocks.captureException).toHaveBeenCalledTimes(1)
    );
  });

  it('captures handled browser errors with sanitized route context', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = 'ph_test';
    const { captureClientException } = await import(
      '@/lib/posthog/client-exceptions'
    );
    const error = new Error('checkout failed');

    expect(
      captureClientException(error, {
        route: 'checkout',
        email: 'buyer@example.com',
      })
    ).toBe(true);

    await vi.waitFor(() =>
      expect(postHogMocks.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        {
          $current_url: window.location.href,
          $pathname: window.location.pathname,
          app_surface: 'web',
          runtime: 'browser',
          route: 'checkout',
          email: '[Filtered]',
        }
      )
    );
    expect(postHogMocks.captureException.mock.calls[0]?.[0]).not.toBe(error);
  });

  it('stamps the failing page URL at call time so a navigation racing the SDK import cannot re-attribute the exception', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = 'ph_test';
    const { captureClientException } = await import(
      '@/lib/posthog/client-exceptions'
    );
    const initialPath = `${window.location.pathname}${window.location.search}`;

    try {
      window.history.replaceState(null, '', '/checkout/pay?token=raw_secret');
      expect(captureClientException(new Error('boundary hit'))).toBe(true);

      // Simulate an error-boundary reset / chunk-recovery reload landing on a
      // DIFFERENT page before the dynamic `import('posthog-js')` resolves.
      window.history.replaceState(null, '', '/next-page');

      await vi.waitFor(() =>
        expect(postHogMocks.captureException).toHaveBeenCalledTimes(1)
      );

      const properties = postHogMocks.captureException.mock.calls[0]?.[1] as
        | Record<string, unknown>
        | undefined;
      // Attribution sticks to the page that failed, with the query redacted
      // by the shared URL sanitizer — not the later /next-page location that
      // posthog-js would auto-derive at capture time.
      expect(properties?.$current_url).toBe(
        `${window.location.origin}/checkout/pay`
      );
      expect(properties?.$pathname).toBe('/checkout/pay');
    } finally {
      window.history.replaceState(null, '', initialPath);
    }
  });

  it('sanitizes handled browser errors before capture', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = 'ph_test';
    const { captureClientException } = await import(
      '@/lib/posthog/client-exceptions'
    );
    const error = new Error(
      'checkout failed for buyer@example.com at https://ogabassey.com/checkout?token=raw_secret&reference=ref_1234567'
    );

    expect(captureClientException(error)).toBe(true);

    await vi.waitFor(() =>
      expect(postHogMocks.captureException).toHaveBeenCalledTimes(1)
    );

    const capturedError = postHogMocks.captureException.mock.calls[0]?.[0] as
      | Error
      | undefined;
    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError).not.toBe(error);
    expect(capturedError?.message).not.toContain('buyer@example.com');
    expect(capturedError?.message).not.toContain('raw_secret');
    expect(capturedError?.message).not.toContain('ref_1234567');
  });

  it('does not allow reserved metadata keys to be overridden', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = 'ph_test';
    const { captureClientException } = await import(
      '@/lib/posthog/client-exceptions'
    );
    const error = new Error('reserved keys');

    expect(
      captureClientException(error, {
        $current_url: 'https://attacker.example/spoofed',
        $pathname: '/spoofed',
        app_surface: 'mobile',
        runtime: 'server',
      })
    ).toBe(true);

    await vi.waitFor(() =>
      expect(postHogMocks.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        {
          $current_url: window.location.href,
          $pathname: window.location.pathname,
          app_surface: 'web',
          runtime: 'browser',
        }
      )
    );
  });
});
