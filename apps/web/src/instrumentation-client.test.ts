import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  capturePostHogPageview: vi.fn(),
  initializeChunkLoadRecovery: vi.fn(),
  initializePostHogBrowser: vi.fn(),
  scheduleIdleBoot: vi.fn((_callback: () => void) => () => undefined),
}));

vi.mock('@/lib/chunk-load-recovery', () => ({
  initializeChunkLoadRecovery: mocks.initializeChunkLoadRecovery,
}));

vi.mock('@/lib/posthog/browser', () => ({
  capturePostHogPageview: mocks.capturePostHogPageview,
  initializePostHogBrowser: mocks.initializePostHogBrowser,
}));

// scheduleIdleBoot is mocked so the test can assert this module NEVER arms a
// module-scope idle boot: PostHogClientBootstrap is the single owner of the
// deferred boot (verified in schedule-idle-boot.test.ts and the component test).
vi.mock('@/lib/posthog/schedule-idle-boot', () => ({
  scheduleIdleBoot: mocks.scheduleIdleBoot,
}));

function importInstrumentationClient() {
  return import('./instrumentation-client');
}

async function flushPostHogMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  delete (globalThis as { __next_s?: unknown }).__next_s;
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('instrumentation-client', () => {
  it('initializes chunk-load recovery eagerly without arming a module-scope boot', async () => {
    vi.stubGlobal('location', { pathname: '/', href: 'https://usebaci.com/' });

    await importInstrumentationClient();

    expect(mocks.initializeChunkLoadRecovery).toHaveBeenCalledOnce();
    // The double-boot is consolidated onto PostHogClientBootstrap; this module
    // no longer schedules its own idle boot.
    expect(mocks.scheduleIdleBoot).not.toHaveBeenCalled();
    expect(mocks.initializePostHogBrowser).not.toHaveBeenCalled();
    expect(mocks.capturePostHogPageview).not.toHaveBeenCalled();
  });

  it('boots browser PostHog when the exported gate is invoked for an eligible path', async () => {
    vi.stubGlobal('location', { pathname: '/', href: 'https://usebaci.com/' });

    const { initializePostHogInstrumentationIfAllowed } =
      await importInstrumentationClient();
    initializePostHogInstrumentationIfAllowed('/products/macbook-pro');

    await vi.waitFor(() => {
      expect(mocks.initializePostHogBrowser).toHaveBeenCalledOnce();
    });
    expect(mocks.initializePostHogBrowser).toHaveBeenCalledWith(
      expect.objectContaining({ NODE_ENV: expect.any(String) })
    );
    expect(mocks.capturePostHogPageview).toHaveBeenCalledOnce();
  });

  it('captures the landing pageview after init so posthog-js can buffer it', async () => {
    vi.stubGlobal('location', { pathname: '/', href: 'https://usebaci.com/' });

    const { initializePostHogInstrumentationIfAllowed } =
      await importInstrumentationClient();
    initializePostHogInstrumentationIfAllowed('/products/macbook-pro');

    await vi.waitFor(() => {
      expect(mocks.capturePostHogPageview).toHaveBeenCalledOnce();
    });
    const [initOrder] = mocks.initializePostHogBrowser.mock.invocationCallOrder;
    const [captureOrder] =
      mocks.capturePostHogPageview.mock.invocationCallOrder;
    expect(initOrder).toBeLessThan(captureOrder);
  });

  it('is idempotent: a second gate invocation does not re-init', async () => {
    vi.stubGlobal('location', { pathname: '/', href: 'https://usebaci.com/' });

    const { initializePostHogInstrumentationIfAllowed } =
      await importInstrumentationClient();
    initializePostHogInstrumentationIfAllowed('/products/macbook-pro');
    initializePostHogInstrumentationIfAllowed('/products/pixel');

    await vi.waitFor(() => {
      expect(mocks.initializePostHogBrowser).toHaveBeenCalledOnce();
    });
    expect(mocks.capturePostHogPageview).toHaveBeenCalledOnce();
  });

  it('does not initialize without a browser window', async () => {
    vi.stubGlobal('window', undefined);

    const { initializePostHogInstrumentationIfAllowed } =
      await importInstrumentationClient();
    initializePostHogInstrumentationIfAllowed('/products/macbook-pro');
    await flushPostHogMicrotasks();

    expect(mocks.initializePostHogBrowser).not.toHaveBeenCalled();
    expect(mocks.capturePostHogPageview).not.toHaveBeenCalled();
  });

  it('skips PostHog on public blog pages', async () => {
    vi.stubGlobal('location', {
      pathname: '/blog/phone-guide',
      href: 'https://ogabassey.com/blog/phone-guide',
    });

    const { initializePostHogInstrumentationIfAllowed } =
      await importInstrumentationClient();
    initializePostHogInstrumentationIfAllowed('/blog/phone-guide');
    await flushPostHogMicrotasks();

    expect(mocks.initializePostHogBrowser).not.toHaveBeenCalled();
    expect(mocks.capturePostHogPageview).not.toHaveBeenCalled();
  });

  it('registers a one-shot post-paint hydration gate when __next_s is empty', async () => {
    vi.useFakeTimers();
    try {
      await importInstrumentationClient();

      const queue = (
        globalThis as {
          __next_s?: {
            length: number;
            reduce: (
              callback: () => Promise<void>,
              initialValue: Promise<void>
            ) => Promise<void>;
          };
        }
      ).__next_s;
      expect(queue).toBeDefined();
      expect(queue?.length).toBe(1);

      let hydrated = false;
      const promise = queue
        ?.reduce(() => Promise.resolve(), Promise.resolve())
        .then(() => {
          hydrated = true;
        });

      expect(queue?.length).toBe(0);
      expect(hydrated).toBe(false);

      await vi.advanceTimersByTimeAsync(100);
      await promise;
      expect(hydrated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
