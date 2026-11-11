// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

const PAGEVIEW_CAPTURE_OPTIONS = { send_instantly: true };

const mocks = vi.hoisted(() => {
  const clientConfigLoaded = vi.fn();
  const posthogCapture = vi.fn();
  const posthogCaptureException = vi.fn();
  const posthogInit = vi.fn();
  const posthogReloadFeatureFlags = vi.fn();
  const posthogRemoteConfigLoad = vi.fn();
  const posthogSetConfig = vi.fn();
  const webVitalsStartIfEnabled = vi.fn();
  const buildPostHogClientConfig = vi.fn(
    (_env: unknown, _token: unknown, options?: { lightweight?: boolean }) => ({
      advanced_disable_flags: options?.lightweight === true,
      api_host: '/baci-relay',
      loaded: clientConfigLoaded,
    })
  );
  const posthogClient = {
    __loaded: false,
    capture: posthogCapture,
    captureException: posthogCaptureException,
    init: posthogInit,
    reloadFeatureFlags: posthogReloadFeatureFlags,
    set_config: posthogSetConfig,
    _remoteConfigLoader: {
      load: posthogRemoteConfigLoad,
    },
    webVitalsAutocapture: {
      startIfEnabled: webVitalsStartIfEnabled,
    },
  };

  return {
    buildPostHogClientConfig,
    clientConfigLoaded,
    posthogCapture,
    posthogCaptureException,
    posthogClient,
    posthogInit,
    posthogReloadFeatureFlags,
    posthogRemoteConfigLoad,
    posthogSetConfig,
    webVitalsStartIfEnabled,
  };
});

interface PostHogInitConfigWithLoaded {
  loaded: (posthogInstance: unknown) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasPostHogLoadedCallback(
  value: unknown
): value is PostHogInitConfigWithLoaded {
  return isRecord(value) && typeof value.loaded === 'function';
}

vi.mock('posthog-js', () => ({
  default: mocks.posthogClient,
}));

vi.mock('@/lib/posthog/client-config', () => ({
  buildPostHogClientConfig: mocks.buildPostHogClientConfig,
}));

function importBrowserInitializer() {
  return import('./browser');
}

function loadPostHogClient() {
  const initConfig = mocks.posthogInit.mock.calls[0]?.[1];

  expect(hasPostHogLoadedCallback(initConfig)).toBe(true);

  if (!hasPostHogLoadedCallback(initConfig)) {
    throw new Error('PostHog init config did not include a loaded callback.');
  }

  initConfig.loaded(mocks.posthogClient);
}

afterEach(() => {
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  mocks.posthogClient.__loaded = false;
  vi.clearAllMocks();
  vi.resetModules();
});

describe('initializePostHogBrowser', () => {
  it('initializes PostHog once when a public project token is configured', async () => {
    const env = {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: ' ph_project_token ',
    };
    const { initializePostHogBrowser } = await importBrowserInitializer();

    initializePostHogBrowser(env);
    initializePostHogBrowser(env);

    expect(mocks.buildPostHogClientConfig).toHaveBeenCalledOnce();
    expect(mocks.buildPostHogClientConfig).toHaveBeenLastCalledWith(
      env,
      'ph_project_token',
      { lightweight: false }
    );
    expect(mocks.posthogInit).toHaveBeenCalledOnce();
    expect(mocks.posthogInit).toHaveBeenCalledWith(
      'ph_project_token',
      expect.objectContaining({
        api_host: '/baci-relay',
        loaded: expect.any(Function),
      })
    );
    expect(mocks.posthogInit.mock.calls[0]?.[1]).not.toHaveProperty(
      'advanced_disable_flags'
    );
    expect(mocks.posthogSetConfig).not.toHaveBeenCalled();
    expect(mocks.posthogReloadFeatureFlags).not.toHaveBeenCalled();
    expect(mocks.posthogRemoteConfigLoad).not.toHaveBeenCalled();
    expect(mocks.webVitalsStartIfEnabled).not.toHaveBeenCalled();
  });

  it('atomically drains persisted client exceptions after init', async () => {
    const { pendingClientExceptionQueue } = await import(
      './pending-client-exception-queue'
    );
    const queuedId = pendingClientExceptionQueue.enqueue(
      new Error('Loading chunk checkout failed.'),
      {
        $current_url: 'https://usebaci.com/merchant-a/checkout',
        recovery_action: 'none',
      }
    );
    const { initializePostHogBrowser } = await importBrowserInitializer();

    initializePostHogBrowser({
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
    });
    loadPostHogClient();

    expect(mocks.posthogCaptureException).toHaveBeenCalledOnce();
    expect(mocks.posthogCaptureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Loading chunk checkout failed.' }),
      {
        $current_url: 'https://usebaci.com/merchant-a/checkout',
        recovery_action: 'none',
      }
    );
    expect(pendingClientExceptionQueue.take(queuedId)).toBeUndefined();
  });

  it('restores a drained client exception when PostHog capture throws', async () => {
    mocks.posthogCaptureException.mockImplementationOnce(() => {
      throw new Error('capture unavailable');
    });
    const { pendingClientExceptionQueue } = await import(
      './pending-client-exception-queue'
    );
    const queuedId = pendingClientExceptionQueue.enqueue(
      new Error('Loading chunk retry failed.')
    );
    const { initializePostHogBrowser } = await importBrowserInitializer();

    initializePostHogBrowser({
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
    });
    loadPostHogClient();

    expect(mocks.posthogCaptureException).toHaveBeenCalledOnce();
    expect(pendingClientExceptionQueue.take(queuedId)).toMatchObject({
      id: queuedId,
    });
  });

  it('requests the lightweight config on public blog surfaces without locking init-time flag config', async () => {
    const env = {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
    };
    vi.stubGlobal('location', {
      hostname: 'usebaci.com',
      pathname: '/ogabassey/blog/best-phones',
      href: 'https://usebaci.com/ogabassey/blog/best-phones',
    });
    const { initializePostHogBrowser } = await importBrowserInitializer();

    initializePostHogBrowser(env);

    expect(mocks.buildPostHogClientConfig).toHaveBeenCalledOnce();
    expect(mocks.buildPostHogClientConfig).toHaveBeenCalledWith(
      env,
      'ph_project_token',
      { lightweight: true }
    );
    expect(mocks.posthogInit).toHaveBeenCalledOnce();
    expect(mocks.posthogInit.mock.calls[0]?.[1]).not.toHaveProperty(
      'advanced_disable_flags'
    );
    expect(mocks.posthogSetConfig).not.toHaveBeenCalled();

    loadPostHogClient();

    expect(mocks.posthogSetConfig).toHaveBeenCalledOnce();
    expect(mocks.posthogSetConfig).toHaveBeenCalledWith({
      advanced_disable_flags: true,
    });
    expect(mocks.posthogSetConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clientConfigLoaded.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY
    );
    expect(mocks.posthogReloadFeatureFlags).not.toHaveBeenCalled();
    expect(mocks.posthogRemoteConfigLoad).not.toHaveBeenCalled();
    expect(mocks.webVitalsStartIfEnabled).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('ignores stale lightweight loaded callbacks after a blog-to-storefront transition', async () => {
    const env = {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
    };
    vi.stubGlobal('location', {
      hostname: 'usebaci.com',
      pathname: '/ogabassey/blog/best-phones',
      href: 'https://usebaci.com/ogabassey/blog/best-phones',
    });
    const { initializePostHogBrowser } = await importBrowserInitializer();

    initializePostHogBrowser(env);

    vi.stubGlobal('location', {
      hostname: 'usebaci.com',
      pathname: '/ogabassey/products',
      href: 'https://usebaci.com/ogabassey/products',
    });
    initializePostHogBrowser(env);
    loadPostHogClient();

    expect(mocks.posthogSetConfig).toHaveBeenCalledOnce();
    expect(mocks.posthogSetConfig).toHaveBeenCalledWith({
      advanced_disable_flags: false,
      api_host: '/baci-relay',
    });
    expect(mocks.posthogSetConfig).not.toHaveBeenCalledWith({
      advanced_disable_flags: true,
    });

    vi.unstubAllGlobals();
  });

  it('reconfigures an initialized client when entering public blog surfaces', async () => {
    const env = {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
    };
    vi.stubGlobal('location', {
      hostname: 'usebaci.com',
      pathname: '/pricing',
      href: 'https://usebaci.com/pricing',
    });
    const { initializePostHogBrowser } = await importBrowserInitializer();

    initializePostHogBrowser(env);

    vi.stubGlobal('location', {
      hostname: 'usebaci.com',
      pathname: '/ogabassey/blog/best-phones',
      href: 'https://usebaci.com/ogabassey/blog/best-phones',
    });
    initializePostHogBrowser(env);

    expect(mocks.buildPostHogClientConfig).toHaveBeenLastCalledWith(
      env,
      'ph_project_token',
      { lightweight: true }
    );
    expect(mocks.posthogSetConfig).toHaveBeenCalledOnce();
    expect(mocks.posthogSetConfig).toHaveBeenCalledWith({
      advanced_disable_flags: true,
      api_host: '/baci-relay',
    });
    expect(mocks.posthogReloadFeatureFlags).not.toHaveBeenCalled();
    expect(mocks.posthogRemoteConfigLoad).not.toHaveBeenCalled();
    expect(mocks.webVitalsStartIfEnabled).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('clears lightweight flag disabling when returning to full instrumentation', async () => {
    const env = {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
    };
    vi.stubGlobal('location', {
      hostname: 'usebaci.com',
      pathname: '/ogabassey/blog/best-phones',
      href: 'https://usebaci.com/ogabassey/blog/best-phones',
    });
    const { initializePostHogBrowser } = await importBrowserInitializer();

    initializePostHogBrowser(env);
    loadPostHogClient();

    vi.stubGlobal('location', {
      hostname: 'usebaci.com',
      pathname: '/ogabassey/products',
      href: 'https://usebaci.com/ogabassey/products',
    });
    initializePostHogBrowser(env);

    expect(mocks.buildPostHogClientConfig).toHaveBeenLastCalledWith(
      env,
      'ph_project_token',
      { lightweight: false }
    );
    expect(mocks.posthogSetConfig).toHaveBeenCalledTimes(2);
    expect(mocks.posthogSetConfig).toHaveBeenNthCalledWith(1, {
      advanced_disable_flags: true,
    });
    expect(mocks.posthogSetConfig).toHaveBeenNthCalledWith(2, {
      advanced_disable_flags: false,
      api_host: '/baci-relay',
    });
    expect(mocks.posthogReloadFeatureFlags).toHaveBeenCalledOnce();
    expect(mocks.posthogRemoteConfigLoad).toHaveBeenCalledOnce();
    expect(
      mocks.posthogRemoteConfigLoad.mock.invocationCallOrder[0]
    ).toBeGreaterThan(mocks.posthogSetConfig.mock.invocationCallOrder[1] ?? 0);
    expect(
      mocks.posthogReloadFeatureFlags.mock.invocationCallOrder[0]
    ).toBeGreaterThan(
      mocks.posthogRemoteConfigLoad.mock.invocationCallOrder[0] ?? 0
    );
    expect(mocks.webVitalsStartIfEnabled).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('queues pageviews until PostHog finishes loading', async () => {
    const env = {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
    };
    const { capturePostHogPageview, initializePostHogBrowser } =
      await importBrowserInitializer();

    capturePostHogPageview('https://usebaci.com/before-init');
    initializePostHogBrowser(env);
    capturePostHogPageview('https://usebaci.com/pricing?plan=starter');
    capturePostHogPageview('https://usebaci.com/dashboard');
    capturePostHogPageview('https://usebaci.com/dashboard');
    capturePostHogPageview('https://usebaci.com/pricing?plan=starter');

    expect(mocks.posthogCapture).not.toHaveBeenCalled();

    loadPostHogClient();

    expect(mocks.clientConfigLoaded).toHaveBeenCalledOnce();
    expect(mocks.posthogCapture).toHaveBeenCalledTimes(4);
    expect(mocks.posthogCapture).toHaveBeenNthCalledWith(
      1,
      '$pageview',
      {
        $current_url: 'https://usebaci.com/before-init',
        app_surface: 'web',
      },
      PAGEVIEW_CAPTURE_OPTIONS
    );
    expect(mocks.posthogCapture).toHaveBeenNthCalledWith(
      2,
      '$pageview',
      {
        $current_url: 'https://usebaci.com/pricing?plan=starter',
        app_surface: 'web',
      },
      PAGEVIEW_CAPTURE_OPTIONS
    );
    expect(mocks.posthogCapture).toHaveBeenNthCalledWith(
      3,
      '$pageview',
      {
        $current_url: 'https://usebaci.com/dashboard',
        app_surface: 'web',
      },
      PAGEVIEW_CAPTURE_OPTIONS
    );
    expect(mocks.posthogCapture).toHaveBeenNthCalledWith(
      4,
      '$pageview',
      {
        $current_url: 'https://usebaci.com/pricing?plan=starter',
        app_surface: 'web',
      },
      PAGEVIEW_CAPTURE_OPTIONS
    );
  });

  it('forwards custom properties with pageviews when loaded or queued', async () => {
    const env = {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
    };
    const { capturePostHogPageview, initializePostHogBrowser } =
      await importBrowserInitializer();

    capturePostHogPageview('https://usebaci.com/blog/guide', {
      $referrer: 'https://google.com',
      $referring_domain: 'google.com',
      utm_source: 'search',
    });
    initializePostHogBrowser(env);
    loadPostHogClient();

    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      '$pageview',
      {
        $current_url: 'https://usebaci.com/blog/guide',
        $referrer: 'https://google.com',
        $referring_domain: 'google.com',
        app_surface: 'web',
        utm_source: 'search',
      },
      PAGEVIEW_CAPTURE_OPTIONS
    );

    capturePostHogPageview('https://usebaci.com/blog/guide-2', {
      $referrer: '$direct',
      $referring_domain: '$direct',
    });

    expect(mocks.posthogCapture).toHaveBeenLastCalledWith(
      '$pageview',
      {
        $current_url: 'https://usebaci.com/blog/guide-2',
        $referrer: '$direct',
        $referring_domain: '$direct',
        app_surface: 'web',
      },
      PAGEVIEW_CAPTURE_OPTIONS
    );
  });

  it('flushes queued pageviews when the PostHog client is already loaded after init', async () => {
    const env = {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
    };
    mocks.posthogInit.mockImplementationOnce(() => {
      mocks.posthogClient.__loaded = true;
    });
    const { capturePostHogPageview, initializePostHogBrowser } =
      await importBrowserInitializer();

    capturePostHogPageview('https://usebaci.com/loaded-state');
    initializePostHogBrowser(env);

    expect(mocks.clientConfigLoaded).not.toHaveBeenCalled();
    expect(mocks.posthogCapture).toHaveBeenCalledOnce();
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      '$pageview',
      {
        $current_url: 'https://usebaci.com/loaded-state',
        app_surface: 'web',
      },
      PAGEVIEW_CAPTURE_OPTIONS
    );
  });

  it('flushes a pageview queued after init when PostHog loads without firing the loaded callback', async () => {
    const env = {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
    };
    const { capturePostHogPageview, initializePostHogBrowser } =
      await importBrowserInitializer();

    initializePostHogBrowser(env);
    mocks.posthogClient.__loaded = true;
    capturePostHogPageview('https://usebaci.com/async-loaded');

    expect(mocks.clientConfigLoaded).not.toHaveBeenCalled();
    expect(mocks.posthogCapture).toHaveBeenCalledOnce();
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      '$pageview',
      {
        $current_url: 'https://usebaci.com/async-loaded',
        app_surface: 'web',
      },
      PAGEVIEW_CAPTURE_OPTIONS
    );
  });

  it('flushes a pageview queued before init when the loaded state flips without firing the loaded callback', async () => {
    // Arrange
    vi.useFakeTimers();
    const env = {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
    };
    const { capturePostHogPageview, initializePostHogBrowser } =
      await importBrowserInitializer();

    capturePostHogPageview('https://usebaci.com/initial-visit');

    // Act
    initializePostHogBrowser(env);

    expect(mocks.posthogCapture).not.toHaveBeenCalled();

    mocks.posthogClient.__loaded = true;
    await vi.runOnlyPendingTimersAsync();

    // Assert
    expect(mocks.clientConfigLoaded).not.toHaveBeenCalled();
    expect(mocks.posthogCapture).toHaveBeenCalledOnce();
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      '$pageview',
      {
        $current_url: 'https://usebaci.com/initial-visit',
        app_surface: 'web',
      },
      PAGEVIEW_CAPTURE_OPTIONS
    );
  });

  it('keeps queued pageviews when PostHog init throws so a retry can flush them', async () => {
    const env = {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
    };
    const initFailure = new Error('temporary init failure');
    mocks.posthogInit.mockImplementationOnce(() => {
      throw initFailure;
    });
    const { capturePostHogPageview, initializePostHogBrowser } =
      await importBrowserInitializer();

    capturePostHogPageview('https://usebaci.com/retry-me');
    expect(() => initializePostHogBrowser(env)).toThrow(initFailure);

    initializePostHogBrowser(env);
    loadPostHogClient();

    expect(mocks.posthogCapture).toHaveBeenCalledOnce();
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      '$pageview',
      {
        $current_url: 'https://usebaci.com/retry-me',
        app_surface: 'web',
      },
      PAGEVIEW_CAPTURE_OPTIONS
    );
  });

  it('clears queued pageviews and disables future queueing when tracking is unconfigured', async () => {
    const warn = vi.fn();
    const { pendingClientExceptionQueue } = await import(
      './pending-client-exception-queue'
    );
    pendingClientExceptionQueue.enqueue(
      new Error('Loading chunk disabled failed.')
    );
    const { capturePostHogPageview, initializePostHogBrowser } =
      await importBrowserInitializer();

    capturePostHogPageview('https://usebaci.com/queued-before-disabled');
    initializePostHogBrowser(
      {
        NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: '',
        NODE_ENV: 'development',
      },
      { warn }
    );
    capturePostHogPageview('https://usebaci.com/after-disabled');
    initializePostHogBrowser({ NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_token' });
    loadPostHogClient();

    expect(warn).toHaveBeenCalledWith(
      '[PostHog] NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is missing; web analytics and error capture are disabled.'
    );
    expect(mocks.posthogCapture).not.toHaveBeenCalled();
    expect(mocks.posthogCaptureException).not.toHaveBeenCalled();
    expect(pendingClientExceptionQueue.drain()).toEqual([]);
  });

  it('swallows client loaded callback errors and still flushes queued pageviews', async () => {
    const warn = vi.fn();
    const env = {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
      NODE_ENV: 'development',
    };
    const loadedFailure = new Error('loaded failed');
    mocks.clientConfigLoaded.mockImplementationOnce(() => {
      throw loadedFailure;
    });
    const { capturePostHogPageview, initializePostHogBrowser } =
      await importBrowserInitializer();

    initializePostHogBrowser(env, { warn });
    capturePostHogPageview('https://usebaci.com/dashboard');

    loadPostHogClient();

    expect(warn).toHaveBeenCalledWith(
      '[PostHog] client loaded callback failed.',
      loadedFailure
    );
    expect(mocks.posthogCapture).toHaveBeenCalledOnce();
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      '$pageview',
      {
        $current_url: 'https://usebaci.com/dashboard',
        app_surface: 'web',
      },
      PAGEVIEW_CAPTURE_OPTIONS
    );
  });

  it('dedupes only consecutive pageview captures for the same URL', async () => {
    const env = {
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
    };
    const { capturePostHogPageview, initializePostHogBrowser } =
      await importBrowserInitializer();

    initializePostHogBrowser(env);
    capturePostHogPageview('https://usebaci.com/pricing');
    loadPostHogClient();
    capturePostHogPageview('https://usebaci.com/pricing');
    capturePostHogPageview('https://usebaci.com/login');
    capturePostHogPageview('https://usebaci.com/pricing');

    expect(mocks.posthogCapture).toHaveBeenCalledTimes(3);
    expect(mocks.posthogCapture).toHaveBeenNthCalledWith(
      1,
      '$pageview',
      {
        $current_url: 'https://usebaci.com/pricing',
        app_surface: 'web',
      },
      PAGEVIEW_CAPTURE_OPTIONS
    );
    expect(mocks.posthogCapture).toHaveBeenNthCalledWith(
      2,
      '$pageview',
      {
        $current_url: 'https://usebaci.com/login',
        app_surface: 'web',
      },
      PAGEVIEW_CAPTURE_OPTIONS
    );
    expect(mocks.posthogCapture).toHaveBeenNthCalledWith(
      3,
      '$pageview',
      {
        $current_url: 'https://usebaci.com/pricing',
        app_surface: 'web',
      },
      PAGEVIEW_CAPTURE_OPTIONS
    );
  });

  it('warns in development when PostHog is not configured', async () => {
    const warn = vi.fn();
    const { initializePostHogBrowser } = await importBrowserInitializer();

    initializePostHogBrowser(
      {
        NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: '',
        NODE_ENV: 'development',
      },
      { warn }
    );

    expect(mocks.posthogInit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[PostHog] NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is missing; web analytics and error capture are disabled.'
    );
  });

  it('stays quiet outside development when PostHog is not configured', async () => {
    const warn = vi.fn();
    const { initializePostHogBrowser } = await importBrowserInitializer();

    initializePostHogBrowser(
      {
        NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: '',
        NODE_ENV: 'production',
      },
      { warn }
    );

    expect(mocks.posthogInit).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('capturePostHogWebVitals', () => {
  const payload = {
    metric: 'LCP',
    value: 2400,
    rating: 'good',
    navigationType: 'navigate',
    pathname: '/ogabassey/products/macbook',
    debugTarget: 'main > img',
  };

  it('does not capture when the PostHog browser client has not been initialized', async () => {
    const { capturePostHogWebVitals } = await importBrowserInitializer();

    capturePostHogWebVitals(payload);

    expect(mocks.posthogCapture).not.toHaveBeenCalled();
  });

  it('does not capture when PostHog is disabled by a missing project token', async () => {
    const { capturePostHogWebVitals, initializePostHogBrowser } =
      await importBrowserInitializer();

    initializePostHogBrowser({ NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: '' });
    capturePostHogWebVitals(payload);

    expect(mocks.posthogInit).not.toHaveBeenCalled();
    expect(mocks.posthogCapture).not.toHaveBeenCalled();
  });

  it('captures a flat web_vitals event once the browser client is initialized', async () => {
    const { capturePostHogWebVitals, initializePostHogBrowser } =
      await importBrowserInitializer();

    initializePostHogBrowser({
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
    });
    capturePostHogWebVitals(payload);

    expect(mocks.posthogCapture).toHaveBeenCalledWith('web_vitals', payload);
  });

  it('buffers metrics reported before init and flushes them once the client initializes', async () => {
    const originHref = 'https://usebaci.com/ogabassey/products/macbook';
    vi.stubGlobal('location', { href: originHref });
    const { capturePostHogWebVitals, initializePostHogBrowser } =
      await importBrowserInitializer();

    // Fires before the idle boot — previously dropped, now buffered.
    capturePostHogWebVitals(payload);
    expect(mocks.posthogCapture).not.toHaveBeenCalled();

    initializePostHogBrowser({
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
    });

    // The flushed event carries the origin URL pinned at enqueue time, so a
    // post-boot navigation cannot re-attribute it to a later page.
    expect(mocks.posthogCapture).toHaveBeenCalledWith('web_vitals', {
      ...payload,
      $current_url: originHref,
      $pathname: payload.pathname,
    });
  });

  it('drops buffered metrics when the project token is missing so they never send', async () => {
    const { capturePostHogWebVitals, initializePostHogBrowser } =
      await importBrowserInitializer();

    capturePostHogWebVitals(payload);
    // Missing token disables PostHog and clears the buffer.
    initializePostHogBrowser({ NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: '' });
    // A later successful init has nothing left to flush.
    initializePostHogBrowser({
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'ph_project_token',
    });

    expect(mocks.posthogCapture).not.toHaveBeenCalled();
  });
});
