import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POSTHOG_ASSETS_HOST,
  DEFAULT_POSTHOG_INGEST_HOST,
  DEFAULT_POSTHOG_PROXY_PATH,
  DEFAULT_POSTHOG_UI_HOST,
  getPostHogAssetsHost,
  getPostHogBrowserEnv,
  getPostHogIngestHost,
  getPostHogLocalProxyPath,
  getPostHogProjectId,
  getPostHogProxyPath,
  getPostHogPublicBuildEnv,
  getPostHogRelayUrl,
  getPostHogReleaseContext,
  getPostHogReleaseVersion,
  getPostHogServerApiKey,
  getPostHogUiHost,
  isPostHogSourceMapUploadEnabled,
  normalizePostHogHost,
  normalizePostHogProxyPath,
  normalizePostHogRelayUrl,
} from './config';

describe('PostHog config helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('normalizes proxy paths for Next rewrites', () => {
    expect(normalizePostHogProxyPath()).toBe(DEFAULT_POSTHOG_PROXY_PATH);
    expect(normalizePostHogProxyPath('baci-observe/')).toBe('/baci-observe');
    expect(normalizePostHogProxyPath('/baci-observe///')).toBe('/baci-observe');
  });

  it('falls back when proxy path overrides collide with reserved app routes', () => {
    expect(normalizePostHogProxyPath('/api')).toBe(DEFAULT_POSTHOG_PROXY_PATH);
    expect(normalizePostHogProxyPath('/checkout/posthog')).toBe(
      DEFAULT_POSTHOG_PROXY_PATH
    );
    expect(
      getPostHogProxyPath({ NEXT_PUBLIC_POSTHOG_PROXY_PATH: '/_next/static' })
    ).toBe(DEFAULT_POSTHOG_PROXY_PATH);
  });

  it('uses EU hosts by default', () => {
    expect(getPostHogIngestHost({})).toBe(DEFAULT_POSTHOG_INGEST_HOST);
    expect(getPostHogAssetsHost({})).toBe(DEFAULT_POSTHOG_ASSETS_HOST);
    expect(getPostHogUiHost({})).toBe(DEFAULT_POSTHOG_UI_HOST);
    expect(getPostHogProxyPath({})).toBe(DEFAULT_POSTHOG_PROXY_PATH);
  });

  it('allows host and proxy overrides', () => {
    const env = {
      NEXT_PUBLIC_POSTHOG_HOST: ' https://custom-ingest.example.com/ ',
      NEXT_PUBLIC_POSTHOG_ASSETS_HOST: ' https://custom-assets.example.com// ',
      NEXT_PUBLIC_POSTHOG_UI_HOST: ' https://custom-ui.example.com/ ',
      NEXT_PUBLIC_POSTHOG_PROXY_PATH: ' baci-observe ',
    };

    expect(getPostHogIngestHost(env)).toBe('https://custom-ingest.example.com');
    expect(getPostHogAssetsHost(env)).toBe('https://custom-assets.example.com');
    expect(getPostHogUiHost(env)).toBe('https://custom-ui.example.com');
    expect(getPostHogProxyPath(env)).toBe('/baci-observe');
  });

  it('prefers external relay URL for browser traffic while keeping local proxy path for Next rewrites', () => {
    const env = {
      NEXT_PUBLIC_POSTHOG_PROXY_PATH: ' /baci-observe/ ',
      NEXT_PUBLIC_POSTHOG_RELAY_URL: ' https://posthog-proxy.usebaci.com/// ',
    };

    expect(normalizePostHogRelayUrl(' https://relay.example.com/ ')).toBe(
      'https://relay.example.com'
    );
    expect(normalizePostHogRelayUrl('javascript:alert(1)')).toBeUndefined();
    expect(normalizePostHogRelayUrl('not a url')).toBeUndefined();
    expect(
      normalizePostHogRelayUrl('http://posthog-proxy.usebaci.com')
    ).toBeUndefined();
    expect(
      normalizePostHogRelayUrl('https://user:pass@posthog-proxy.usebaci.com')
    ).toBeUndefined();
    expect(
      normalizePostHogRelayUrl(
        'https://posthog-proxy.usebaci.com/proxy?x=1#frag'
      )
    ).toBe('https://posthog-proxy.usebaci.com');
    expect(normalizePostHogRelayUrl('http://localhost:8787/relay')).toBe(
      'http://localhost:8787'
    );
    expect(getPostHogRelayUrl(env)).toBe('https://posthog-proxy.usebaci.com');
    expect(getPostHogProxyPath(env)).toBe('https://posthog-proxy.usebaci.com');
    expect(getPostHogLocalProxyPath(env)).toBe('/baci-observe');

    expect(
      getPostHogProxyPath({
        NEXT_PUBLIC_POSTHOG_RELAY_URL: 'not-a-url',
        NEXT_PUBLIC_POSTHOG_PROXY_PATH: '/baci-observe',
      })
    ).toBe('/baci-observe');
  });

  it('builds the public browser environment allowlist', () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', 'phc_public');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROXY_PATH', '/baci-relay');
    vi.stubEnv(
      'NEXT_PUBLIC_POSTHOG_RELAY_URL',
      'https://posthog-proxy.usebaci.com'
    );
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_RELEASE_VERSION', 'public-release');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_UI_HOST', 'https://eu.posthog.com');
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'usebaci.com');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF', 'main');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA', 'public-sha');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_URL', 'baci-git-main.vercel.app');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('POSTHOG_API_KEY', 'phx_secret');

    expect(getPostHogBrowserEnv()).toEqual({
      NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'phc_public',
      NEXT_PUBLIC_POSTHOG_PROXY_PATH: '/baci-relay',
      NEXT_PUBLIC_POSTHOG_RELAY_URL: 'https://posthog-proxy.usebaci.com',
      NEXT_PUBLIC_POSTHOG_RELEASE_VERSION: 'public-release',
      NEXT_PUBLIC_POSTHOG_UI_HOST: 'https://eu.posthog.com',
      NEXT_PUBLIC_ROOT_DOMAIN: 'usebaci.com',
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: 'main',
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: 'public-sha',
      NEXT_PUBLIC_VERCEL_ENV: 'production',
      NEXT_PUBLIC_VERCEL_URL: 'baci-git-main.vercel.app',
      NODE_ENV: 'production',
    });
  });

  it('does not read private Vercel env fallbacks from the browser allowlist', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF', '   ');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA', '   ');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '   ');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_URL', '   ');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'main');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'vercel-sha');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_URL', 'https://baci-git-main.vercel.app/checkout');

    expect(getPostHogBrowserEnv()).toMatchObject({
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: '   ',
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: '   ',
      NEXT_PUBLIC_VERCEL_ENV: '   ',
      NEXT_PUBLIC_VERCEL_URL: '   ',
    });
  });

  it('backfills public Vercel browser fields at build time', () => {
    expect(
      getPostHogPublicBuildEnv({
        NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: '   ',
        NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: '   ',
        NEXT_PUBLIC_VERCEL_ENV: '   ',
        NEXT_PUBLIC_VERCEL_URL: '   ',
        VERCEL_GIT_COMMIT_REF: 'main',
        VERCEL_GIT_COMMIT_SHA: 'vercel-sha',
        VERCEL_ENV: 'production',
        VERCEL_URL: 'https://baci-git-main.vercel.app/checkout',
      })
    ).toEqual({
      NEXT_PUBLIC_POSTHOG_RELEASE_VERSION: 'vercel-sha',
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: 'main',
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: 'vercel-sha',
      NEXT_PUBLIC_VERCEL_ENV: 'production',
      NEXT_PUBLIC_VERCEL_URL: 'baci-git-main.vercel.app',
    });
  });

  it('normalizes host overrides without changing empty fallback behavior', () => {
    expect(normalizePostHogHost(' https://posthog.example.com/// ')).toBe(
      'https://posthog.example.com'
    );
    expect(normalizePostHogHost('   ')).toBe('');
    expect(normalizePostHogHost(undefined)).toBe('');
  });

  it('enables source-map uploads only when secret and project id exist', () => {
    expect(isPostHogSourceMapUploadEnabled({})).toBe(false);
    expect(
      isPostHogSourceMapUploadEnabled({
        POSTHOG_API_KEY: 'phx_secret',
        POSTHOG_PROJECT_ID: '202711',
      })
    ).toBe(true);
  });

  it('reads and trims the server api key, returning undefined when blank', () => {
    expect(getPostHogServerApiKey({ POSTHOG_API_KEY: ' phx_secret ' })).toBe(
      'phx_secret'
    );
    expect(getPostHogServerApiKey({ POSTHOG_API_KEY: '  ' })).toBeUndefined();
    expect(getPostHogServerApiKey({})).toBeUndefined();
  });

  it('reads and trims the project id, returning undefined when blank', () => {
    expect(getPostHogProjectId({ POSTHOG_PROJECT_ID: ' 202711 ' })).toBe(
      '202711'
    );
    expect(getPostHogProjectId({ POSTHOG_PROJECT_ID: '' })).toBeUndefined();
    expect(getPostHogProjectId({})).toBeUndefined();
  });

  it('uses the most specific release version available', () => {
    expect(
      getPostHogReleaseVersion({
        POSTHOG_RELEASE_VERSION: 'release-1',
        VERCEL_GIT_COMMIT_SHA: 'vercel-sha',
      })
    ).toBe('release-1');
    expect(
      getPostHogReleaseVersion({
        NEXT_PUBLIC_POSTHOG_RELEASE_VERSION: 'public-release',
        VERCEL_GIT_COMMIT_SHA: 'vercel-sha',
        GITHUB_SHA: 'github-sha',
      })
    ).toBe('public-release');
    expect(
      getPostHogReleaseVersion({
        VERCEL_GIT_COMMIT_SHA: 'vercel-sha',
        GITHUB_SHA: 'github-sha',
      })
    ).toBe('vercel-sha');
  });

  it('builds a safe deployment release context', () => {
    expect(
      getPostHogReleaseContext({
        POSTHOG_RELEASE_VERSION: 'release-1',
        VERCEL_GIT_COMMIT_SHA: 'vercel-sha',
        VERCEL_GIT_COMMIT_REF: 'main',
        VERCEL_ENV: 'production',
        VERCEL_URL: 'https://baci-git-main.vercel.app/checkout?token=secret',
      })
    ).toEqual({
      release_version: 'release-1',
      git_commit_sha: 'vercel-sha',
      git_commit_ref: 'main',
      vercel_environment: 'production',
      vercel_url: 'baci-git-main.vercel.app',
    });
  });

  it('builds release context from public Vercel fallbacks', () => {
    expect(
      getPostHogReleaseContext({
        NEXT_PUBLIC_POSTHOG_RELEASE_VERSION: 'public-release',
        NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: 'public-sha',
        NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: 'main',
        NEXT_PUBLIC_VERCEL_ENV: 'production',
        NEXT_PUBLIC_VERCEL_URL: 'https://baci-public.vercel.app/',
      })
    ).toEqual({
      release_version: 'public-release',
      git_commit_sha: 'public-sha',
      git_commit_ref: 'main',
      vercel_environment: 'production',
      vercel_url: 'baci-public.vercel.app',
    });
  });

  it('drops malformed deployment URLs from release context', () => {
    expect(
      getPostHogReleaseContext({
        POSTHOG_RELEASE_VERSION: 'release-1',
        VERCEL_URL: 'https://:443',
      })
    ).toEqual({
      release_version: 'release-1',
    });
  });
});
