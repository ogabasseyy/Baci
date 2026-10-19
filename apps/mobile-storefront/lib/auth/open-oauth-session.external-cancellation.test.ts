import {
  type OAuthBrowserModule,
  openOAuthSession,
} from './open-oauth-session';

function browserModule(
  overrides: Partial<OAuthBrowserModule> = {}
): OAuthBrowserModule {
  return {
    getCustomTabsSupportingBrowsersAsync: jest.fn().mockResolvedValue({
      browserPackages: [],
      defaultBrowserPackage: undefined,
      preferredBrowserPackage: undefined,
      servicePackages: [],
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

describe('openOAuthSession external browser cancellation', () => {
  it('accepts a redirect that arrives after launch resolution and AppState active', async () => {
    const adapters = externalBrowserAdapters({ currentState: 'background' });
    const webBrowser = browserModule();

    const resultPromise = openOAuthSession({
      appState: adapters.appState,
      linking: adapters.linking,
      platform: 'android',
      redirectUrl: 'ogabassey://auth',
      url: 'https://accounts.google.com/oauth',
      webBrowser,
    });
    await adapters.listenersReady;
    await Promise.resolve();
    adapters.emitAppState('active');
    adapters.emitUrl('ogabassey://auth?code=after-active');

    await expect(resultPromise).resolves.toEqual({
      type: 'success',
      url: 'ogabassey://auth?code=after-active',
    });
  });

  it('keeps the listener alive for a delayed redirect after AppState active', async () => {
    jest.useFakeTimers();
    try {
      const adapters = externalBrowserAdapters({ currentState: 'background' });
      const webBrowser = browserModule();
      let resolveOpenURL: (() => void) | undefined;
      adapters.linking.openURL = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveOpenURL = resolve;
          })
      );

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
      resolveOpenURL?.();
      await Promise.resolve();
      jest.advanceTimersByTime(250);
      adapters.emitUrl('ogabassey://auth?code=delayed-after-active');

      await expect(resultPromise).resolves.toEqual({
        type: 'success',
        url: 'ogabassey://auth?code=delayed-after-active',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancels when AppState active arrives before launch resolution without a redirect', async () => {
    jest.useFakeTimers();
    try {
      const adapters = externalBrowserAdapters({ currentState: 'background' });
      const webBrowser = browserModule();
      let resolveOpenURL: (() => void) | undefined;
      adapters.linking.openURL = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveOpenURL = resolve;
          })
      );

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
      resolveOpenURL?.();
      await Promise.resolve();
      jest.advanceTimersByTime(1_000);

      await expect(resultPromise).resolves.toEqual({ type: 'cancel' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancels after returning active when no redirect arrives', async () => {
    const adapters = externalBrowserAdapters({ currentState: 'background' });
    const webBrowser = browserModule();

    const resultPromise = openOAuthSession({
      appState: adapters.appState,
      linking: adapters.linking,
      platform: 'android',
      redirectUrl: 'ogabassey://auth',
      url: 'https://accounts.google.com/oauth',
      webBrowser,
    });
    await adapters.listenersReady;
    await Promise.resolve();
    adapters.emitAppState('active');

    await expect(resultPromise).resolves.toEqual({ type: 'cancel' });
    expect(adapters.removeUrl).toHaveBeenCalled();
  });
});
