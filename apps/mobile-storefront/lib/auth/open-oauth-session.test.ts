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

describe('openOAuthSession', () => {
  it('uses a PackageManager-supported browser without BrowserProxyActivity on Android', async () => {
    const webBrowser = browserModule();

    const result = await openOAuthSession({
      platform: 'android',
      redirectUrl: 'ogabassey://auth',
      url: 'https://accounts.google.com/oauth',
      webBrowser,
    });

    expect(result).toEqual({
      type: 'success',
      url: 'ogabassey://auth?code=oauth-code',
    });
    expect(webBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://accounts.google.com/oauth',
      'ogabassey://auth',
      {
        browserPackage: 'browser.preferred',
        createTask: false,
        showInRecents: false,
        useProxyActivity: false,
      }
    );
  });

  it('preserves the existing browser behavior on non-Android platforms', async () => {
    const webBrowser = browserModule();

    await openOAuthSession({
      platform: 'ios',
      redirectUrl: 'ogabassey://auth',
      url: 'https://accounts.google.com/oauth',
      webBrowser,
    });

    expect(
      webBrowser.getCustomTabsSupportingBrowsersAsync
    ).not.toHaveBeenCalled();
    expect(webBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://accounts.google.com/oauth',
      'ogabassey://auth',
      { showInRecents: true }
    );
  });
});
