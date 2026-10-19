import { DEFAULT_ROOT_DOMAIN } from '@/lib/default-root-domain';
import type { StorefrontSlugSafetyReason } from '@/lib/storefront-slug-safety';

export type StorefrontInternalPreflightFailOpenReason =
  | 'no-secret'
  | 'no-base-url'
  | 'redirect'
  | `http-${number}`
  | 'non-json'
  | 'parse'
  | 'has-error'
  | 'unsafe-redirect'
  | 'timeout'
  | 'fetch-error'
  | 'circuit-open';

export type StorefrontInternalPreflightSurface =
  | 'blog-listing-status'
  | 'blog-post-status'
  | 'compare-page-status'
  | 'compare-hub-status'
  | 'product-canonical'
  | 'product-slug';

interface StorefrontInternalPreflightContext {
  surface: StorefrontInternalPreflightSurface;
  identifier: string;
  slug: string;
  reason: StorefrontInternalPreflightFailOpenReason;
  status?: number;
  /**
   * Bounded, secrets-free diagnostic string (e.g. a PostgREST `code message`)
   * that pins down WHY a fail-open happened. warnFailOpen surfaces it via the
   * spread; captureFailOpen forwards it as a PostHog property.
   */
  detail?: string;
}

/**
 * Wire value the internal preflight routes use to mark their DESIGNED
 * unknown/unpublished-storefront fail-open verdict. Client response schemas
 * still accept any string so a mixed-deploy caller never hard-fails parsing a
 * future reason value; this constant keeps route emitters and the client
 * comparison from drifting apart.
 */
export const UNKNOWN_STOREFRONT_FAIL_OPEN_REASON = 'unknown-storefront';

/**
 * Reasons a preflight is skipped or resolved as expected non-incident garbage:
 * unsafe bot slugs (never sent to the internal route), the internal
 * `unknown-storefront` verdict (junk subdomains / unpublished stores), an
 * open circuit breaker, and a per-instance concurrency cap (both already
 * captured or bounded at their transport boundary).
 */
type StorefrontInternalPreflightSkipReason =
  | StorefrontSlugSafetyReason
  | typeof UNKNOWN_STOREFRONT_FAIL_OPEN_REASON
  | 'circuit-open'
  | 'concurrency-limit';

interface StorefrontInternalPreflightSkipContext {
  surface: StorefrontInternalPreflightSurface;
  identifier: string;
  slug: string;
  reason: StorefrontInternalPreflightSkipReason;
}

// Bot slugs reach kilobytes; bound every diagnostic copy so log lines and
// telemetry payloads stay small no matter what the request path carried.
const MAX_DIAGNOSTIC_SLUG_LENGTH = 120;

function truncateSlugForDiagnostics(value: string): string {
  const normalized = String(value ?? '').replace(/[\r\n\t]/g, '');
  if (normalized.length <= MAX_DIAGNOSTIC_SLUG_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_DIAGNOSTIC_SLUG_LENGTH)}…(+${
    normalized.length - MAX_DIAGNOSTIC_SLUG_LENGTH
  })`;
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

function isLoopbackHost(value: string): boolean {
  try {
    return isLoopbackOrigin(new URL(`http://${value}`).origin);
  } catch {
    return false;
  }
}

function normalizeTrustedInternalBaseUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `${isLoopbackHost(trimmed) ? 'http' : 'https'}://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.username || url.password) return null;
    if (url.protocol !== 'https:' && !isLoopbackOrigin(url.origin)) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function isProductionDeploymentEnvironment() {
  const vercelEnv = process.env.VERCEL_ENV?.trim();
  if (vercelEnv) return vercelEnv === 'production';

  return process.env.NODE_ENV === 'production';
}

function resolveBaseUrl(origin: string): string | null {
  if (isLoopbackOrigin(origin)) return origin;

  const vercelEnv = process.env.VERCEL_ENV?.trim();
  if (vercelEnv && vercelEnv !== 'production') return null;

  const configuredRootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim();
  const rootDomain =
    configuredRootDomain ||
    (isProductionDeploymentEnvironment() ? DEFAULT_ROOT_DOMAIN : undefined);
  const configuredBaseUrl = normalizeTrustedInternalBaseUrl(rootDomain);

  if (configuredBaseUrl) return configuredBaseUrl;

  return null;
}

function warnFailOpen(context: StorefrontInternalPreflightContext) {
  console.warn('[storefront-internal-preflight] fail-open', {
    ...context,
    identifier: truncateSlugForDiagnostics(context.identifier),
    slug: truncateSlugForDiagnostics(context.slug),
  });
  // Pass the original context through — captureFailOpen truncates the slug
  // itself, and truncating twice would mangle the `…(+N)` marker.
  // Best-effort telemetry: captureFailOpen already swallows its own errors,
  // and this trailing catch guarantees the fire-and-forget promise can never
  // reject into the request lifecycle.
  void captureFailOpen(context).catch(() => false);
}

/**
 * A deliberately skipped preflight (unsafe/malformed slug) is expected bot
 * garbage, not an incident: log it bounded, never capture an exception.
 */
function warnSkip(context: StorefrontInternalPreflightSkipContext) {
  const log =
    context.reason === UNKNOWN_STOREFRONT_FAIL_OPEN_REASON ||
    context.reason === 'circuit-open' ||
    context.reason === 'concurrency-limit'
      ? console.warn
      : console.info;

  log('[storefront-internal-preflight] skip', {
    ...context,
    identifier: truncateSlugForDiagnostics(context.identifier),
    slug: truncateSlugForDiagnostics(context.slug),
  });
}

async function captureFailOpen(context: StorefrontInternalPreflightContext) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return false;
  }

  try {
    const { captureServerException } = await import('@/lib/posthog/server');
    return await captureServerException(
      new Error(
        `Storefront internal preflight fail-open: ${context.surface} ${context.reason}`
      ),
      {
        // Group PostHog issues per surface+reason: without this, every failure
        // mode shares one fingerprint (same Error type + frame), so a lone
        // http-401 can title an issue whose volume is really timeouts.
        $exception_fingerprint: `storefront-internal-preflight:${context.surface}:${context.reason}`,
        detail: context.detail,
        event_source: 'storefront-internal-preflight',
        identifier: truncateSlugForDiagnostics(context.identifier),
        reason: context.reason,
        slug: truncateSlugForDiagnostics(context.slug),
        status: context.status,
        surface: context.surface,
      }
    );
  } catch {
    return false;
  }
}

function isJsonResponse(response: Response) {
  return response.headers.get('content-type')?.toLowerCase().includes('json');
}

async function readJsonResponse(
  response: Response,
  context: Omit<StorefrontInternalPreflightContext, 'reason'>
): Promise<unknown | null> {
  if (response.status >= 300 && response.status < 400) {
    warnFailOpen({
      ...context,
      reason: 'redirect',
      status: response.status,
    });
    return null;
  }

  if (!response.ok) {
    warnFailOpen({
      ...context,
      reason: `http-${response.status}`,
      status: response.status,
    });
    return null;
  }

  if (!isJsonResponse(response)) {
    warnFailOpen({
      ...context,
      reason: 'non-json',
      status: response.status,
    });
    return null;
  }

  try {
    return await response.json();
  } catch (error) {
    warnFailOpen({
      ...context,
      // The fetch budget can abort while the BODY is still streaming —
      // `response.json()` then rejects with the abort, which is a timeout,
      // not a malformed payload.
      reason: isAbortLikeError(error) ? 'timeout' : 'parse',
      status: response.status,
    });
    return null;
  }
}

function isAbortLikeError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

function getFetchErrorReason(
  error: unknown
): StorefrontInternalPreflightFailOpenReason {
  return isAbortLikeError(error) ? 'timeout' : 'fetch-error';
}

export const storefrontInternalPreflight = {
  getFetchErrorReason,
  captureFailOpen,
  isLoopbackOrigin,
  readJsonResponse,
  resolveBaseUrl,
  warnFailOpen,
  warnSkip,
};
