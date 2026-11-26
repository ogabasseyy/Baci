export const DEFAULT_POSTHOG_INGEST_HOST = 'https://eu.i.posthog.com';
export const DEFAULT_POSTHOG_ASSETS_HOST = 'https://eu-assets.i.posthog.com';
export const DEFAULT_POSTHOG_UI_HOST = 'https://eu.posthog.com';
export const DEFAULT_POSTHOG_PROXY_PATH = '/baci-relay';
const RESERVED_POSTHOG_PROXY_PATH_PREFIXES = [
  '/api',
  '/_next',
  '/admin',
  '/auth',
  '/builder',
  '/checkout',
  '/dashboard',
  '/login',
  '/logout',
  '/track',
] as const;

export type PostHogEnv = Record<string, string | undefined>;

export function getPostHogBrowserEnv(): PostHogEnv {
  return {
    NEXT_PUBLIC_POSTHOG_RELEASE_VERSION:
      process.env.NEXT_PUBLIC_POSTHOG_RELEASE_VERSION,
    NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN:
      process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
    NEXT_PUBLIC_POSTHOG_PROXY_PATH: process.env.NEXT_PUBLIC_POSTHOG_PROXY_PATH,
    NEXT_PUBLIC_POSTHOG_RELAY_URL: process.env.NEXT_PUBLIC_POSTHOG_RELAY_URL,
    NEXT_PUBLIC_POSTHOG_UI_HOST: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST,
    NEXT_PUBLIC_ROOT_DOMAIN: process.env.NEXT_PUBLIC_ROOT_DOMAIN,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF:
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF,
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA:
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    NEXT_PUBLIC_VERCEL_URL: process.env.NEXT_PUBLIC_VERCEL_URL,
    NODE_ENV: process.env.NODE_ENV,
  };
}

export function normalizePostHogProxyPath(value?: string | null): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    return DEFAULT_POSTHOG_PROXY_PATH;
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const normalized =
    withLeadingSlash.replace(/\/+$/, '') || DEFAULT_POSTHOG_PROXY_PATH;

  return isReservedPostHogProxyPath(normalized)
    ? DEFAULT_POSTHOG_PROXY_PATH
    : normalized;
}

function isReservedPostHogProxyPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return RESERVED_POSTHOG_PROXY_PATH_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

export function normalizePostHogHost(value: string | undefined): string {
  return value?.trim().replace(/\/+$/, '') ?? '';
}

export function getPostHogIngestHost(env: PostHogEnv = process.env): string {
  return (
    normalizePostHogHost(env.NEXT_PUBLIC_POSTHOG_HOST) ||
    DEFAULT_POSTHOG_INGEST_HOST
  );
}

export function getPostHogAssetsHost(env: PostHogEnv = process.env): string {
  return (
    normalizePostHogHost(env.NEXT_PUBLIC_POSTHOG_ASSETS_HOST) ||
    DEFAULT_POSTHOG_ASSETS_HOST
  );
}

export function getPostHogUiHost(env: PostHogEnv = process.env): string {
  return (
    normalizePostHogHost(env.NEXT_PUBLIC_POSTHOG_UI_HOST) ||
    DEFAULT_POSTHOG_UI_HOST
  );
}

export function normalizePostHogRelayUrl(
  value?: string | null
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed);
    const isLocalHttp =
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
    if (parsed.protocol !== 'https:' && !isLocalHttp) {
      return undefined;
    }
    if (parsed.username || parsed.password) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function getPostHogRelayUrl(
  env: PostHogEnv = process.env
): string | undefined {
  return normalizePostHogRelayUrl(env.NEXT_PUBLIC_POSTHOG_RELAY_URL);
}

export function getPostHogLocalProxyPath(
  env: PostHogEnv = process.env
): string {
  return normalizePostHogProxyPath(env.NEXT_PUBLIC_POSTHOG_PROXY_PATH);
}

export function getPostHogProxyPath(env: PostHogEnv = process.env): string {
  return getPostHogRelayUrl(env) ?? getPostHogLocalProxyPath(env);
}

export function isPostHogSourceMapUploadEnabled(
  env: PostHogEnv = process.env
): boolean {
  return Boolean(env.POSTHOG_API_KEY?.trim() && env.POSTHOG_PROJECT_ID?.trim());
}

/**
 * Server-only personal API key used to run HogQL queries against the PostHog
 * project (e.g. the web-vitals health cron). Never expose this to the client.
 */
export function getPostHogServerApiKey(
  env: PostHogEnv = process.env
): string | undefined {
  return env.POSTHOG_API_KEY?.trim() || undefined;
}

/**
 * Numeric PostHog project id for the project-scoped query API
 * (`/api/projects/{id}/query/`).
 */
export function getPostHogProjectId(
  env: PostHogEnv = process.env
): string | undefined {
  return env.POSTHOG_PROJECT_ID?.trim() || undefined;
}

function firstNonEmptyEnvValue(
  ...values: Array<string | undefined>
): string | undefined {
  return values
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value));
}

function normalizeVercelDeploymentUrl(
  value: string | undefined
): string | undefined {
  const rawValue = firstNonEmptyEnvValue(value);
  if (!rawValue) {
    return undefined;
  }

  const candidate = /^https?:\/\//i.test(rawValue)
    ? rawValue
    : `https://${rawValue}`;

  try {
    return new URL(candidate).host;
  } catch {
    return undefined;
  }
}

export function getPostHogReleaseVersion(
  env: PostHogEnv = process.env
): string | undefined {
  return firstNonEmptyEnvValue(
    env.POSTHOG_RELEASE_VERSION,
    env.NEXT_PUBLIC_POSTHOG_RELEASE_VERSION,
    env.VERCEL_GIT_COMMIT_SHA,
    env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    env.GITHUB_SHA
  );
}

export function getPostHogPublicBuildEnv(
  env: PostHogEnv = process.env
): Record<string, string> {
  const publicBuildEnv = {
    NEXT_PUBLIC_POSTHOG_RELEASE_VERSION: getPostHogReleaseVersion(env),
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: firstNonEmptyEnvValue(
      env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF,
      env.VERCEL_GIT_COMMIT_REF,
      env.GITHUB_REF_NAME
    ),
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: firstNonEmptyEnvValue(
      env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
      env.VERCEL_GIT_COMMIT_SHA,
      env.GITHUB_SHA
    ),
    NEXT_PUBLIC_VERCEL_ENV: firstNonEmptyEnvValue(
      env.NEXT_PUBLIC_VERCEL_ENV,
      env.VERCEL_ENV,
      env.NODE_ENV
    ),
    NEXT_PUBLIC_VERCEL_URL: firstNonEmptyEnvValue(
      normalizeVercelDeploymentUrl(
        firstNonEmptyEnvValue(env.NEXT_PUBLIC_VERCEL_URL, env.VERCEL_URL)
      )
    ),
  };

  return Object.fromEntries(
    Object.entries(publicBuildEnv).filter((entry): entry is [string, string] =>
      Boolean(entry[1])
    )
  );
}

export function getPostHogReleaseContext(
  env: PostHogEnv = process.env
): Record<string, string> {
  const releaseVersion = getPostHogReleaseVersion(env);
  const gitCommitSha = firstNonEmptyEnvValue(
    env.VERCEL_GIT_COMMIT_SHA,
    env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    env.GITHUB_SHA
  );
  const gitCommitRef = firstNonEmptyEnvValue(
    env.VERCEL_GIT_COMMIT_REF,
    env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF,
    env.GITHUB_REF_NAME
  );
  const vercelEnvironment = firstNonEmptyEnvValue(
    env.VERCEL_ENV,
    env.NEXT_PUBLIC_VERCEL_ENV,
    env.NODE_ENV
  );
  const vercelUrl = normalizeVercelDeploymentUrl(
    firstNonEmptyEnvValue(env.VERCEL_URL, env.NEXT_PUBLIC_VERCEL_URL)
  );

  return Object.fromEntries(
    Object.entries({
      release_version: releaseVersion,
      git_commit_sha: gitCommitSha,
      git_commit_ref: gitCommitRef,
      vercel_environment: vercelEnvironment,
      vercel_url: vercelUrl,
    }).filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
}
