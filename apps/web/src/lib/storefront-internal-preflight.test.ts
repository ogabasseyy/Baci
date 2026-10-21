import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  captureServerException: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/posthog/server', () => ({
  captureServerException: mocks.captureServerException,
}));

import { storefrontInternalPreflight } from './storefront-internal-preflight';

const ORIGINAL_ENV = {
  NEXT_PUBLIC_ROOT_DOMAIN: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
  NEXT_RUNTIME: process.env.NEXT_RUNTIME,
  NODE_ENV: process.env.NODE_ENV,
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  VERCEL_URL: process.env.VERCEL_URL,
};

function restoreEnv() {
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (key === 'NODE_ENV') continue;
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function clearEnv() {
  delete process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  delete process.env.NEXT_RUNTIME;
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.VERCEL_URL;
  vi.stubEnv('NODE_ENV', 'test');
}

const CONTEXT = {
  surface: 'product-slug' as const,
  identifier: 'ogabassey.com',
  slug: 'missing-product',
};

describe('storefrontInternalPreflight', () => {
  beforeEach(() => {
    clearEnv();
    mocks.captureServerException.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it('routes through the public root domain instead of generated Vercel hosts', () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
    process.env.VERCEL_URL = 'baci-protected.vercel.app';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'baci-prod.vercel.app';

    expect(
      storefrontInternalPreflight.resolveBaseUrl('https://ogabassey.com')
    ).toBe('https://usebaci.com');
  });

  it('prefers the loopback request origin over the configured public root', () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';

    expect(
      storefrontInternalPreflight.resolveBaseUrl('http://localhost:3000')
    ).toBe('http://localhost:3000');
  });

  it('normalizes bare loopback root domains to http', () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'localhost:3000';

    expect(
      storefrontInternalPreflight.resolveBaseUrl('https://ogabassey.com')
    ).toBe('http://localhost:3000');
  });

  it('does not route preview deployment preflights through the production root', () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = 'usebaci.com';
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');

    expect(
      storefrontInternalPreflight.resolveBaseUrl(
        'https://baci-feature.vercel.app'
      )
    ).toBeNull();
  });

  it('uses the hardcoded public root fallback only for production deployments', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');

    expect(
      storefrontInternalPreflight.resolveBaseUrl('https://ogabassey.com')
    ).toBe('https://usebaci.com');

    clearEnv();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');

    expect(
      storefrontInternalPreflight.resolveBaseUrl('https://ogabassey.com')
    ).toBeNull();
  });

  it('allows loopback origins for local development only', () => {
    expect(
      storefrontInternalPreflight.resolveBaseUrl('http://localhost:3000')
    ).toBe('http://localhost:3000');
    expect(
      storefrontInternalPreflight.resolveBaseUrl('https://ogabassey.com')
    ).toBeNull();
  });

  it('fails closed for redirects before JSON parsing', async () => {
    const result = await storefrontInternalPreflight.readJsonResponse(
      new Response('<!doctype html>', {
        headers: { 'Content-Type': 'text/html' },
        status: 302,
      }),
      CONTEXT
    );

    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'redirect', status: 302 })
    );
  });

  it('fails closed for non-JSON 200 responses before parsing HTML', async () => {
    const result = await storefrontInternalPreflight.readJsonResponse(
      new Response('<!doctype html>', {
        headers: { 'Content-Type': 'text/html' },
        status: 200,
      }),
      CONTEXT
    );

    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'non-json', status: 200 })
    );
  });

  it('parses JSON responses', async () => {
    await expect(
      storefrontInternalPreflight.readJsonResponse(
        new Response(JSON.stringify({ hasError: false }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        }),
        CONTEXT
      )
    ).resolves.toEqual({ hasError: false });
  });

  it('fails closed for non-ok, non-redirect responses', async () => {
    const result = await storefrontInternalPreflight.readJsonResponse(
      new Response('Internal Server Error', { status: 500 }),
      CONTEXT
    );

    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'http-500', status: 500 })
    );
  });

  it('fails closed when the JSON body cannot be parsed', async () => {
    const result = await storefrontInternalPreflight.readJsonResponse(
      new Response('{not valid json', {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
      CONTEXT
    );

    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'parse', status: 200 })
    );
  });

  it('classifies a body-read abort as a timeout, not a parse failure', async () => {
    const abortedBody = new ReadableStream({
      start(controller) {
        controller.error(new DOMException('aborted', 'AbortError'));
      },
    });

    const result = await storefrontInternalPreflight.readJsonResponse(
      new Response(abortedBody, {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
      CONTEXT
    );

    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[storefront-internal-preflight] fail-open',
      expect.objectContaining({ reason: 'timeout', status: 200 })
    );
  });

  it('truncates multi-kilobyte identifiers in fail-open logs and telemetry', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const hugeIdentifier = `${'sub.'.repeat(1000)}example.com`;

    try {
      storefrontInternalPreflight.warnFailOpen({
        ...CONTEXT,
        identifier: hugeIdentifier,
        reason: 'has-error',
      });
      await vi.waitFor(() =>
        expect(mocks.captureServerException).toHaveBeenCalled()
      );

      const [, warnContext] = consoleWarnSpy.mock.calls.find(
        ([message]) => message === '[storefront-internal-preflight] fail-open'
      ) as [string, { identifier: string }];
      expect(warnContext.identifier.length).toBeLessThan(200);
      const [, captureContext] = mocks.captureServerException.mock.calls[0] as [
        Error,
        { identifier: string },
      ];
      expect(captureContext.identifier.length).toBeLessThan(200);
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('maps fetch exceptions to timeout or fetch-error reasons', () => {
    expect(
      storefrontInternalPreflight.getFetchErrorReason(
        new DOMException('aborted', 'AbortError')
      )
    ).toBe('timeout');
    expect(
      storefrontInternalPreflight.getFetchErrorReason(
        new DOMException('timed out', 'TimeoutError')
      )
    ).toBe('timeout');
    expect(
      storefrontInternalPreflight.getFetchErrorReason(new Error('boom'))
    ).toBe('fetch-error');
  });

  it('captures fail-open diagnostics in the Node.js runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');

    await expect(
      storefrontInternalPreflight.captureFailOpen({
        ...CONTEXT,
        reason: 'fetch-error',
        status: 500,
      })
    ).resolves.toBe(true);

    expect(mocks.captureServerException).toHaveBeenCalledWith(
      expect.any(Error),
      {
        // Groups PostHog issues per surface+reason so one failure mode can
        // never title or re-open an issue for a different one.
        $exception_fingerprint:
          'storefront-internal-preflight:product-slug:fetch-error',
        event_source: 'storefront-internal-preflight',
        identifier: 'ogabassey.com',
        reason: 'fetch-error',
        slug: 'missing-product',
        status: 500,
        surface: 'product-slug',
      }
    );
  });

  it('forwards the error detail to fail-open telemetry when present', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');

    await expect(
      storefrontInternalPreflight.captureFailOpen({
        ...CONTEXT,
        reason: 'has-error',
        detail: 'PGRST202 Could not find the function',
      })
    ).resolves.toBe(true);

    expect(mocks.captureServerException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        detail: 'PGRST202 Could not find the function',
      })
    );
  });

  it('fails closed when fail-open diagnostic capture rejects', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    mocks.captureServerException.mockRejectedValueOnce(
      new Error('posthog unavailable')
    );

    await expect(
      storefrontInternalPreflight.captureFailOpen({
        ...CONTEXT,
        reason: 'fetch-error',
        status: 500,
      })
    ).resolves.toBe(false);
  });

  it('does not import server PostHog from non-Node runtimes', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');

    await expect(
      storefrontInternalPreflight.captureFailOpen({
        ...CONTEXT,
        reason: 'fetch-error',
      })
    ).resolves.toBe(false);

    expect(mocks.captureServerException).not.toHaveBeenCalled();
  });

  it('truncates multi-kilobyte slugs in fail-open logs and telemetry', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const hugeSlug = 'a'.repeat(4000);

    try {
      storefrontInternalPreflight.warnFailOpen({
        ...CONTEXT,
        slug: hugeSlug,
        reason: 'has-error',
      });
      // Let the fire-and-forget capture settle before asserting on it.
      await vi.waitFor(() =>
        expect(mocks.captureServerException).toHaveBeenCalled()
      );

      const [, warnContext] = consoleWarnSpy.mock.calls.find(
        ([message]) => message === '[storefront-internal-preflight] fail-open'
      ) as [string, { slug: string }];
      expect(warnContext.slug.length).toBeLessThan(200);
      const [, captureContext] = mocks.captureServerException.mock.calls[0] as [
        Error,
        { slug: string },
      ];
      expect(captureContext.slug.length).toBeLessThan(200);
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('does not reject into the request when telemetry capture rejects inside warnFailOpen', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    mocks.captureServerException.mockRejectedValueOnce(
      new Error('posthog unavailable')
    );
    const unhandledRejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      expect(() =>
        storefrontInternalPreflight.warnFailOpen({
          ...CONTEXT,
          reason: 'has-error',
        })
      ).not.toThrow();
      await vi.waitFor(() =>
        expect(mocks.captureServerException).toHaveBeenCalled()
      );
      // Deterministically drain the microtask queue (no timer): the rejected
      // capture promise settles and warnFailOpen's synchronous `.catch`
      // handler runs within these microtask ticks. Node reports an unhandled
      // rejection on the same microtask checkpoint, so if warnFailOpen had NOT
      // attached a handler it would already be in `unhandledRejections` here.
      await Promise.resolve();
      await Promise.resolve();

      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      consoleWarnSpy.mockRestore();
    }
  });

  it('logs malformed skipped preflights as bounded info and never captures exceptions', () => {
    const consoleInfoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      storefrontInternalPreflight.warnSkip({
        surface: 'product-slug',
        identifier: 'ogabassey.com',
        slug: `%25${'a'.repeat(3000)}`,
        reason: 'too-long',
      });

      expect(consoleWarnSpy).not.toHaveBeenCalled();
      const [message, context] = consoleInfoSpy.mock.calls[0] as [
        string,
        { reason: string; slug: string },
      ];
      expect(message).toBe('[storefront-internal-preflight] skip');
      expect(context.reason).toBe('too-long');
      expect(context.slug.length).toBeLessThan(200);
      expect(mocks.captureServerException).not.toHaveBeenCalled();
    } finally {
      consoleInfoSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    }
  });
});
