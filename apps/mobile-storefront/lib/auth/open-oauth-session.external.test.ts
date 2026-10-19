import {
  type OAuthBrowserModule,
  openOAuthSession,
} from './open-oauth-session';

function browserModule(
  overrides: Partial<OAuthBrowserModule> = {}
): OAuthBrowserModule {
  return {
    getCustomTabsSupportingBrowsersAsync: jest.fn().mockResolvedValue({
      browserPackages: ['browser.preferred'],
      defaultBrowserPackage: 'browser.preferred',
      preferredBrowserPackage: 'browser.preferred',
      servicePackages: ['browser.preferred'],
    }),
    openAuthSessionAsync: jest.fn().mockResolvedValue({
      type: 'success',
      url: 'ogabassey://auth?code=oauth-code',
    }),
    ...overrides,
  };
}

function externalBrowserAdapters({
  currentState,
}: {
  currentState?: 'active' | 'background' | null;
} = {}) {
  let onUrl: ((event: { url: string }) => void) | undefined;
  let onAppState:
    | ((state: 'active' | 'background' | string) => void)
    | undefined;
  let resolveListenersReady: (() => void) | undefined;
  const listenersReady = new Promise<void>((resolve) => {
    resolveListenersReady = resolve;
  });
  const removeUrl = jest.fn();
  const removeAppState = jest.fn();
  const linking = {
    addEventListener: jest.fn(
      (_event: 'url', listener: (event: { url: string }) => void) => {
        onUrl = listener;
        resolveListenersReady?.();
        return { remove: removeUrl };
      }
    ),
    openURL: jest.fn().mockResolvedValue(undefined),
  };
  const appState = {
    currentState,
    addEventListener: jest.fn(
      (
        _event: 'change',
        listener: (state: 'active' | 'background' | string) => void
      ) => {
        onAppState = listener;
        return { remove: removeAppState };
      }
    ),
  };
  return {
    appState,
    emitAppState: (state: 'active' | 'background' | string) =>
      onAppState?.(state),
    emitUrl: (url: string) => onUrl?.({ url }),
    linking,
    listenersReady,
    removeAppState,
    removeUrl,
  };
}

describe('openOAuthSession external browser fallback', () => {
  it('falls back to the system URL handler when no Custom Tabs browser is available', async () => {
    const adapters = externalBrowserAdapters();
    const webBrowser = browserModule({
      getCustomTabsSupportingBrowsersAsync: jest.fn().mockResolvedValue({
        browserPackages: [],
        defaultBrowserPackage: undefined,
        preferredBrowserPackage: undefined,
        servicePackages: [],
      }),
    });

    const resultPromise = openOAuthSession({
      appState: adapters.appState,
      linking: adapters.linking,
      platform: 'android',
      redirectUrl: 'ogabassey://auth',
      url: 'https://accounts.google.com/oauth',
      webBrowser,
    });
    await adapters.listenersReady;
    adapters.emitUrl('ogabassey://auth?code=fallback-code');

    await expect(resultPromise).resolves.toEqual({
      type: 'success',
      url: 'ogabassey://auth?code=fallback-code',
    });
    expect(webBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
    expect(adapters.linking.openURL).toHaveBeenCalledWith(
      'https://accounts.google.com/oauth'
    );
    expect(adapters.removeUrl).toHaveBeenCalled();
    expect(adapters.removeAppState).toHaveBeenCalled();
  });

  it('ignores colliding callbacks before accepting the configured redirect', async () => {
    const adapters = externalBrowserAdapters();
    const webBrowser = browserModule({
      getCustomTabsSupportingBrowsersAsync: jest.fn().mockResolvedValue({
        browserPackages: [],
        defaultBrowserPackage: undefined,
        preferredBrowserPackage: undefined,
        servicePackages: [],
      }),
    });

    const resultPromise = openOAuthSession({
      appState: adapters.appState,
      linking: adapters.linking,
      platform: 'android',
      redirectUrl: 'ogabassey://auth',
      url: 'https://accounts.google.com/oauth',
      webBrowser,
    });
    await adapters.listenersReady;
    adapters.emitUrl('ogabassey://auth.evil?code=attacker');
    adapters.emitUrl('ogabassey://auth?code=valid');

    await expect(resultPromise).resolves.toEqual({
      type: 'success',
      url: 'ogabassey://auth?code=valid',
    });
  });

  it('ignores the initial active snapshot when AppState was unavailable', async () => {
    const adapters = externalBrowserAdapters({ currentState: null });
    const webBrowser = browserModule({
      getCustomTabsSupportingBrowsersAsync: jest.fn().mockResolvedValue({
        browserPackages: [],
        defaultBrowserPackage: undefined,
        preferredBrowserPackage: undefined,
        servicePackages: [],
      }),
    });

    const resultPromise = openOAuthSession({
      appState: adapters.appState,
      linking: adapters.linking,
      platform: 'android',
      redirectUrl: 'ogabassey://auth',
      url: 'https://accounts.google.com/oauth',
      webBrowser,
    });
    await adapters.listenersReady;
    adapters.emitAppState('active');
    adapters.emitUrl('ogabassey://auth?code=initial-state-safe');

    await expect(resultPromise).resolves.toEqual({
      type: 'success',
      url: 'ogabassey://auth?code=initial-state-safe',
    });
  });

  it('ignores the initial active snapshot when AppState currentState is omitted', async () => {
    const adapters = externalBrowserAdapters();
    const webBrowser = browserModule({
      getCustomTabsSupportingBrowsersAsync: jest.fn().mockResolvedValue({
        browserPackages: [],
        defaultBrowserPackage: undefined,
        preferredBrowserPackage: undefined,
        servicePackages: [],
      }),
    });

    const resultPromise = openOAuthSession({
      appState: adapters.appState,
      linking: adapters.linking,
      platform: 'android',
      redirectUrl: 'ogabassey://auth',
      url: 'https://accounts.google.com/oauth',
      webBrowser,
    });
    await adapters.listenersReady;
    adapters.emitAppState('active');
    adapters.emitUrl('ogabassey://auth?code=omitted-state-safe');

    await expect(resultPromise).resolves.toEqual({
      type: 'success',
      url: 'ogabassey://auth?code=omitted-state-safe',
    });
  });

  it('falls back after an Android browser launch SecurityException', async () => {
    const adapters = externalBrowserAdapters();
    const launchError = Object.assign(
      new Error('Custom Tabs SecurityException'),
      { name: 'SecurityException' }
    );
    const webBrowser = browserModule({
      openAuthSessionAsync: jest.fn().mockRejectedValue(launchError),
    });

    const resultPromise = openOAuthSession({
      appState: adapters.appState,
      linking: adapters.linking,
      platform: 'android',
      redirectUrl: 'ogabassey://auth',
      url: 'https://accounts.google.com/oauth',
      webBrowser,
    });
    await adapters.listenersReady;
    adapters.emitUrl('ogabassey://auth?code=fallback-code');

    await expect(resultPromise).resolves.toEqual({
      type: 'success',
      url: 'ogabassey://auth?code=fallback-code',
    });
    expect(adapters.linking.openURL).toHaveBeenCalled();
  });

  it('falls back when Expo reports that the browser activity is unavailable', async () => {
    const adapters = externalBrowserAdapters();
    const webBrowser = browserModule({
      openAuthSessionAsync: jest
        .fn()
        .mockRejectedValue(new Error('No matching browser activity found')),
    });

    const resultPromise = openOAuthSession({
      appState: adapters.appState,
      linking: adapters.linking,
      platform: 'android',
      redirectUrl: 'ogabassey://auth',
      url: 'https://accounts.google.com/oauth',
      webBrowser,
    });
    await adapters.listenersReady;
    adapters.emitUrl('ogabassey://auth?code=activity-fallback');

    await expect(resultPromise).resolves.toEqual({
      type: 'success',
      url: 'ogabassey://auth?code=activity-fallback',
    });
    expect(adapters.linking.openURL).toHaveBeenCalledWith(
      'https://accounts.google.com/oauth'
    );
  });
});
