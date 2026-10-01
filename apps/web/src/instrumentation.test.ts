import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestError, register } from './instrumentation';

const registerOTelMock = vi.hoisted(() => vi.fn());
const captureServerExceptionMock = vi.hoisted(() => vi.fn());
const captureServerEventMock = vi.hoisted(() => vi.fn());
const setRateLimitDiagnosticHookMock = vi.hoisted(() => vi.fn());

vi.mock('@vercel/otel', () => ({
  registerOTel: registerOTelMock,
}));

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: captureServerEventMock,
  captureServerException: captureServerExceptionMock,
}));

vi.mock('@/lib/rate-limit', () => ({
  setRateLimitDiagnosticHook: setRateLimitDiagnosticHookMock,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv('NEXT_OTEL_FETCH_DISABLED', '0');
});

describe('instrumentation register', () => {
  it('registers Vercel OpenTelemetry in the Node.js runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('VERCEL_ENV', 'preview');

    await register();

    expect(registerOTelMock).toHaveBeenCalledWith({
      attributes: {
        'deployment.environment': 'preview',
      },
      serviceName: 'baci-web',
    });
    expect(process.env.NEXT_OTEL_FETCH_DISABLED).toBe('1');
    expect(setRateLimitDiagnosticHookMock).toHaveBeenCalledOnce();
  });

  it('wires fixed-cardinality rate-limit outcomes to server telemetry', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    captureServerEventMock.mockResolvedValue(true);

    await register();

    const hook = setRateLimitDiagnosticHookMock.mock.calls.at(-1)?.[0] as
      | ((diagnostic: {
          backend: 'redis' | 'memory';
          reason: 'redis_success' | 'redis_unavailable' | 'redis_error';
        }) => void)
      | undefined;

    hook?.({ backend: 'memory', reason: 'redis_error' });
    hook?.({ backend: 'memory', reason: 'redis_error' });
    hook?.({ backend: 'redis', reason: 'redis_success' });

    expect(captureServerEventMock).toHaveBeenCalledTimes(2);
    expect(captureServerEventMock).toHaveBeenNthCalledWith(
      1,
      'rate_limit_backend',
      {
        backend: 'memory',
        reason: 'redis_error',
        telemetry_source: 'rate_limit',
      }
    );
    expect(captureServerEventMock).toHaveBeenNthCalledWith(
      2,
      'rate_limit_backend',
      {
        backend: 'redis',
        reason: 'redis_success',
        telemetry_source: 'rate_limit',
      }
    );
  });

  it('retries a diagnostic after telemetry delivery fails', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    captureServerEventMock.mockResolvedValue(false);

    await register();

    const hook = setRateLimitDiagnosticHookMock.mock.calls.at(-1)?.[0] as
      | ((diagnostic: {
          backend: 'redis' | 'memory';
          reason: 'redis_success' | 'redis_unavailable' | 'redis_error';
        }) => void)
      | undefined;

    hook?.({ backend: 'memory', reason: 'redis_unavailable' });
    await Promise.resolve();
    hook?.({ backend: 'memory', reason: 'redis_unavailable' });

    expect(captureServerEventMock).toHaveBeenCalledTimes(2);
  });

  it('logs invalid quiz phase configuration that fails before the deployment assertion', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('QUIZ_PHASE', 'invalid');
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(register()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      'Quiz deployment phase validation failed during boot',
      expect.objectContaining({
        message: 'QUIZ_PHASE must be 1a or production',
      })
    );
  });

  it('does not register OpenTelemetry outside the Node.js runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');

    await register();

    expect(registerOTelMock).not.toHaveBeenCalled();
  });
});

describe('onRequestError', () => {
  it('captures Next.js request errors with route context in the Node.js runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const error = new Error('render failed');
    const request = {
      headers: {
        host: 'Ogabassey.com',
        'x-merchant-domain': 'Ogabassey.com',
        'x-merchant-slug': 'Ogabassey',
      },
      method: 'POST',
      path: '/checkout?email=buyer@example.com#payment',
    } as Parameters<typeof onRequestError>[1];
    const context = {
      renderSource: 'react-server-components',
      revalidateReason: undefined,
      routePath: '/checkout',
      routeType: 'render',
      routerKind: 'App Router',
    } as Parameters<typeof onRequestError>[2];

    await onRequestError(error, request, context);

    expect(captureServerExceptionMock).toHaveBeenCalledWith(error, {
      render_source: 'react-server-components',
      merchant_domain: 'ogabassey.com',
      merchant_slug: 'ogabassey',
      request_method: 'POST',
      request_host: 'ogabassey.com',
      request_path: '/checkout',
      revalidate_reason: undefined,
      route_path: '/checkout',
      route_type: 'render',
      router_kind: 'App Router',
    });
  });

  it('adds the Next.js digest for React-processed Server Component errors', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const error = Object.assign(new Error(''), { digest: 'NEXT_DIGEST_123' });

    await onRequestError(
      error,
      {
        headers: { host: 'ogabassey.com' },
        method: 'GET',
        path: '/blog',
      } as Parameters<typeof onRequestError>[1],
      {
        revalidateReason: 'stale',
        routePath: '/(storefront)/[slug]/(blog)/blog/page',
        routeType: 'render',
        routerKind: 'App Router',
      } as Parameters<typeof onRequestError>[2]
    );

    expect(captureServerExceptionMock).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        next_error_digest: 'NEXT_DIGEST_123',
        request_path: '/blog',
        revalidate_reason: 'stale',
      })
    );
  });

  it.each([
    ['missing digest', new Error('')],
    ['empty digest', Object.assign(new Error(''), { digest: '' })],
    ['blank digest', Object.assign(new Error(''), { digest: '   ' })],
    ['non-string digest', Object.assign(new Error(''), { digest: 123 })],
  ])('omits %s from request error properties', async (_label, error) => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');

    await onRequestError(
      error,
      {
        headers: { host: 'ogabassey.com' },
        method: 'GET',
        path: '/blog',
      } as Parameters<typeof onRequestError>[1],
      {
        revalidateReason: 'stale',
        routePath: '/(storefront)/[slug]/(blog)/blog/page',
        routeType: 'render',
        routerKind: 'App Router',
      } as Parameters<typeof onRequestError>[2]
    );

    expect(captureServerExceptionMock).toHaveBeenCalledTimes(1);
    const properties = captureServerExceptionMock.mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(properties).not.toHaveProperty('next_error_digest');
    expect(properties).toEqual(
      expect.objectContaining({
        request_path: '/blog',
        revalidate_reason: 'stale',
      })
    );
  });

  it('does not capture request errors outside the Node.js runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');

    await onRequestError(
      new Error('edge error'),
      {
        headers: {},
        method: 'GET',
        path: '/store',
      } as Parameters<typeof onRequestError>[1],
      {} as Parameters<typeof onRequestError>[2]
    );

    expect(captureServerExceptionMock).not.toHaveBeenCalled();
  });
});
