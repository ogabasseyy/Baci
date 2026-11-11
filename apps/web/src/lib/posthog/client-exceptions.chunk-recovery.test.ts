// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  importFailure: new Error('posthog chunk unavailable'),
  loadSdk: vi.fn(),
  reloadPending: false,
}));

vi.mock('@/lib/posthog/posthog-sdk-loader', () => ({
  loadPostHogBrowserSdk: mocks.loadSdk,
}));

function getLoadedSdk() {
  return Promise.resolve({
    default: { captureException: mocks.captureException },
  });
}

vi.mock('@/lib/chunk-load-recovery', () => ({
  isChunkRecoveryReloadPending: () => mocks.reloadPending,
}));

function createChunkError(message = 'Loading chunk checkout failed.') {
  const error = new Error(message);
  error.name = 'ChunkLoadError';
  return error;
}

describe('PostHog client chunk exceptions', () => {
  const originalToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

  beforeEach(() => {
    vi.resetModules();
    window.sessionStorage.clear();
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = 'ph_test';
    mocks.captureException.mockReset();
    mocks.loadSdk.mockReset();
    mocks.loadSdk.mockImplementation(getLoadedSdk);
    mocks.reloadPending = false;
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    } else {
      process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = originalToken;
    }
  });

  it('persists a sanitized declined chunk exception when the SDK import fails', async () => {
    mocks.loadSdk.mockRejectedValueOnce(mocks.importFailure);
    const { captureClientException } = await import('./client-exceptions');
    const error = createChunkError(
      'Loading chunk checkout failed for buyer@example.com at /_next/static/chunks/checkout.js?token=raw_secret'
    );

    expect(
      captureClientException(error, {
        recovery_action: 'none',
        route_surface: 'storefront',
      })
    ).toBe(true);
    await vi.waitFor(() => expect(mocks.loadSdk).toHaveBeenCalledOnce());

    const { pendingClientExceptionQueue } = await import(
      './pending-client-exception-queue'
    );
    const [queuedException] = pendingClientExceptionQueue.drain();
    const queuedError = queuedException?.error as Error | undefined;

    expect(mocks.captureException).not.toHaveBeenCalled();
    expect(queuedError?.name).toBe('ChunkLoadError');
    expect(queuedError?.message).not.toContain('buyer@example.com');
    expect(queuedError?.message).not.toContain('raw_secret');
    expect(queuedException?.properties).toMatchObject({
      recovery_action: 'none',
      route_surface: 'storefront',
    });
  });

  it('keeps reload-scheduled chunk recovery on the boot-free telemetry path', async () => {
    mocks.reloadPending = true;
    const { captureClientException } = await import('./client-exceptions');

    expect(
      captureClientException(createChunkError(), {
        recovery_action: 'reload-scheduled',
      })
    ).toBe(true);
    await Promise.resolve();
    const { pendingClientExceptionQueue } = await import(
      './pending-client-exception-queue'
    );

    expect(mocks.loadSdk).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
    expect(pendingClientExceptionQueue.drain()).toEqual([]);
  });

  it('claims a queued chunk exception after a successful SDK import', async () => {
    const { captureClientException } = await import('./client-exceptions');

    expect(captureClientException(createChunkError())).toBe(true);
    await vi.waitFor(() =>
      expect(mocks.captureException).toHaveBeenCalledOnce()
    );

    const { pendingClientExceptionQueue } = await import(
      './pending-client-exception-queue'
    );
    expect(pendingClientExceptionQueue.drain()).toEqual([]);
  });

  it('skips direct capture when browser initialization drains the queue first', async () => {
    let resolveSdk:
      | ((sdk: Awaited<ReturnType<typeof getLoadedSdk>>) => void)
      | undefined;
    mocks.loadSdk.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSdk = resolve;
      })
    );
    const { captureClientException } = await import('./client-exceptions');

    expect(captureClientException(createChunkError())).toBe(true);
    const { pendingClientExceptionQueue } = await import(
      './pending-client-exception-queue'
    );
    const [drainedException] = pendingClientExceptionQueue.drain();
    expect(drainedException).toBeDefined();
    mocks.captureException(
      drainedException?.error,
      drainedException?.properties
    );

    resolveSdk?.(await getLoadedSdk());
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.loadSdk).toHaveBeenCalledOnce();
    expect(mocks.captureException).toHaveBeenCalledOnce();
  });

  it('restores a claimed chunk exception when direct capture throws', async () => {
    mocks.captureException.mockImplementationOnce(() => {
      throw new Error('capture failed');
    });
    const { captureClientException } = await import('./client-exceptions');

    expect(captureClientException(createChunkError())).toBe(true);
    await vi.waitFor(() =>
      expect(mocks.captureException).toHaveBeenCalledOnce()
    );

    const { pendingClientExceptionQueue } = await import(
      './pending-client-exception-queue'
    );
    expect(pendingClientExceptionQueue.drain()).toHaveLength(1);
  });
});
