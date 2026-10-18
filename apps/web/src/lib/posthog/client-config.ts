import type { CaptureResult, PostHogConfig, Properties } from 'posthog-js';
import { dropRecoveredChunkExceptionCapture } from '@/lib/posthog/chunk-recovery-exception-filter';
import {
  getPostHogProxyPath,
  getPostHogReleaseContext,
  getPostHogUiHost,
  type PostHogEnv,
} from '@/lib/posthog/config';
import { sanitizePostHogExceptionText } from '@/lib/posthog/exception-text';
import { isPublicBlogPathname } from '@/lib/posthog/public-blog-path';
import { getPostHogTracingHeaderHostnames } from '@/lib/posthog/tracing-hostnames';

// Record replay for ~5% of eligible sessions (WEIGHT-B P1, owner-approved
// 2026-07-10): rrweb's input serializer (`maskAllInputs` masking every
// keystroke) was the single worst field INP contributor — a 1,096ms
// #document.oninput LoAF on checkout forms and search-as-you-type — and that
// cost lands on every RECORDED session. 5% keeps dozens of replays/day for UX
// debugging while removing the tax from 95% of visitors. posthog-js's
// `session_recording.sampleRate` (0..1) takes precedence over the project's
// remote sampling config — verified against @posthog/types
// `SessionRecordingOptions.sampleRate` in posthog-js@1.393.5.
const SESSION_RECORDING_SAMPLE_RATE = 0.05;

const SENSITIVE_PROPERTY_TOKENS = new Set([
  'password',
  'passcode',
  'token',
  'secret',
  'authorization',
  'cookie',
  'otp',
  'pin',
  'cvv',
  'card',
  'bvn',
  'nin',
  'email',
  'phone',
  'address',
]);
const URL_PROPERTY_PATTERN =
  /(?:url|href|referrer|current_url|pathname|request_path)/i;
const AUTOCAPTURE_TEXT_PROPERTY_PATTERN =
  /^(?:\$el_text|\$elements_chain|text|attr__(?:aria-label|placeholder|title))$/i;
const EMAIL_VALUE_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const REDACTED_VALUE = '[Filtered]';
const QUERY_OR_HASH_PATTERN = /[?#]/;
const EXCEPTION_LIST_PROPERTY_KEY = '$exception_list';
// Both PostHog's autocapture `$web_vitals` event and our own flat `web_vitals`
// event (see capturePostHogWebVitals in lib/posthog/browser.ts) must be dropped
// on public blog/SEO surfaces. Matching only `$web_vitals` here would let the
// custom event through — keep this set as the single source of truth.
const WEB_VITALS_EVENT_NAMES = new Set(['$web_vitals', 'web_vitals']);
const RESERVED_WEB_TENANT_SUBDOMAINS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'dashboard',
  'mail',
  'smtp',
]);
const PLATFORM_ROOT_ROUTE_SEGMENTS = new Set([
  '',
  '_next',
  'about',
  'admin',
  'api',
  'auth',
  'blog',
  'builder',
  'cart',
  'checkout',
  'contact',
  'dashboard',
  'debug-auth',
  'delete-account',
  'demo',
  'developers',
  'favicon.ico',
  'features',
  'feeds',
  'invite',
  'login',
  'manifest.webmanifest',
  'onboarding',
  'pricing',
  'privacy',
  'products',
  'reset-password',
  'robots.txt',
  'signup',
  'sitemap.xml',
  'staff',
  'template-preview',
  'terms',
  'track',
]);
const VALID_MERCHANT_SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TENANT_CONTEXT_PROPERTY_KEYS = [
  'merchant_domain',
  'merchant_id',
  'merchant_slug',
] as const;
const POSTHOG_PROJECT_CREDENTIAL_PROPERTY_KEYS = ['token', 'api_key'] as const;
// React 418/419 are hydration mismatch and Suspense fallback/client-render
// switches; keep modern-browser occurrences actionable and filter only known
// unsupported browser noise below.
const REACT_HYDRATION_OR_SUSPENSE_ERROR_PATTERN =
  /react\.dev\/errors\/(?:418|419)\b/;
const SYNTHETIC_SCRIPT_ERROR_MESSAGE = 'Script error.';
type SupportedBrowserVersion = {
  major: number;
  minor: number;
};

// Match the current supported browser floor used by the web app so old browser
// compatibility failures do not hide real hydration issues in supported Chrome,
// Firefox, Safari, or Edge versions.
const MIN_SUPPORTED_BROWSER_VERSION_BY_NAME: Record<
  string,
  SupportedBrowserVersion
> = {
  chrome: { major: 93, minor: 0 },
  chromium: { major: 93, minor: 0 },
  edge: { major: 93, minor: 0 },
  firefox: { major: 92, minor: 0 },
  ios: { major: 15, minor: 4 },
  safari: { major: 15, minor: 4 },
  'mobile safari': { major: 15, minor: 4 },
};

function isValidMerchantSlug(value: string): boolean {
  return (
    VALID_MERCHANT_SUBDOMAIN_REGEX.test(value) &&
    !RESERVED_WEB_TENANT_SUBDOMAINS.has(value) &&
    !PLATFORM_ROOT_ROUTE_SEGMENTS.has(value)
  );
}

interface BrowserLocationLike {
  hostname: string;
  pathname: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function redactUrlQuery(value: string): string {
  const markerIndex = value.search(QUERY_OR_HASH_PATTERN);
  return markerIndex === -1 ? value : value.slice(0, markerIndex);
}

function isSensitivePropertyKey(key: string): boolean {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((token) => SENSITIVE_PROPERTY_TOKENS.has(token));
}

function normalizeHostname(hostname: string): string {
  return (
    hostname
      .trim()
      .toLowerCase()
      .replace(/^www\./, '')
      .split(':')[0] ?? ''
  );
}

function normalizeRootDomain(env: PostHogEnv): string {
  return normalizeHostname(env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com');
}

function isLocalOrPreviewHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.vercel.app')
  );
}

function getPathMerchantSlug(pathname: string): string | undefined {
  const slug = pathname.split('/').find(Boolean)?.toLowerCase();
  if (!slug || !isValidMerchantSlug(slug)) {
    return undefined;
  }

  return slug;
}

export function resolvePostHogWebTenantContext(
  env: PostHogEnv = process.env,
  location: BrowserLocationLike | undefined = typeof globalThis.location ===
  'undefined'
    ? undefined
    : globalThis.location
): Properties {
  if (!location) {
    return {};
  }

  const hostname = normalizeHostname(location.hostname);
  if (!hostname || isLocalOrPreviewHost(hostname)) {
    return {};
  }

  const rootDomain = normalizeRootDomain(env);
  const tenantContext: Properties = {};

  if (hostname === rootDomain) {
    const merchantSlug = getPathMerchantSlug(location.pathname);
    if (merchantSlug) {
      tenantContext.merchant_slug = merchantSlug;
    }

    return tenantContext;
  }

  if (hostname.endsWith(`.${rootDomain}`)) {
    const merchantSlug = hostname.slice(0, -(rootDomain.length + 1));
    if (isValidMerchantSlug(merchantSlug)) {
      tenantContext.merchant_slug = merchantSlug;
      tenantContext.merchant_domain = hostname;
    }

    return tenantContext;
  }

  tenantContext.merchant_domain = hostname;
  return tenantContext;
}

function sanitizeExceptionListValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizePostHogExceptionText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeExceptionListValue(item));
  }

  if (isRecord(value)) {
    const sanitized = Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeExceptionListValue(entryValue),
      ])
    );

    return sanitizePostHogProperties(sanitized);
  }

  return value;
}

function sanitizePropertyValue(key: string, value: unknown): unknown {
  if (key === EXCEPTION_LIST_PROPERTY_KEY) {
    return sanitizeExceptionListValue(value);
  }

  if (AUTOCAPTURE_TEXT_PROPERTY_PATTERN.test(key)) {
    return REDACTED_VALUE;
  }

  if (isSensitivePropertyKey(key)) {
    return REDACTED_VALUE;
  }

  if (typeof value === 'string') {
    if (URL_PROPERTY_PATTERN.test(key)) {
      return redactUrlQuery(value);
    }

    return value.replace(EMAIL_VALUE_PATTERN, REDACTED_VALUE);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizePropertyValue(key, item));
  }

  if (isRecord(value)) {
    return sanitizePostHogProperties(value);
  }

  return value;
}

function getPublicPostHogProjectToken(): string | undefined {
  return process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim() || undefined;
}

function restorePostHogProjectCredentialProperties(
  properties: Properties,
  projectToken: string | undefined
): Properties {
  if (!projectToken) {
    return properties;
  }

  return {
    ...properties,
    ...Object.fromEntries(
      POSTHOG_PROJECT_CREDENTIAL_PROPERTY_KEYS.map((key) => [key, projectToken])
    ),
  } as Properties;
}

function getStringValues(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (typeof value === 'number') {
    return [String(value)];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => getStringValues(item));
}

function getExceptionMessages(properties: Properties): string[] {
  const exceptionValues = getStringValues(properties.$exception_values);
  const exceptionListMessages = Array.isArray(properties.$exception_list)
    ? properties.$exception_list.flatMap((entry) =>
        isRecord(entry) ? getStringValues(entry.value) : []
      )
    : [];

  return [...exceptionValues, ...exceptionListMessages];
}

/**
 * Detects synthetic cross-origin script exceptions. Browsers collapse those
 * failures to "Script error.", and PostHog confirms the synthetic source with
 * mechanism.synthetic=true; missing exception structure safely stays actionable.
 */
function hasSyntheticScriptError(properties: Properties): boolean {
  if (
    !getExceptionMessages(properties).some(
      (message) => message === SYNTHETIC_SCRIPT_ERROR_MESSAGE
    )
  ) {
    return false;
  }

  return Array.isArray(properties.$exception_list)
    ? properties.$exception_list.some(
        (entry) =>
          isRecord(entry) &&
          isRecord(entry.mechanism) &&
          entry.mechanism.synthetic === true
      )
    : false;
}

function parseBrowserVersion(value: unknown): SupportedBrowserVersion | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return parseBrowserVersion(String(value));
  }

  if (typeof value !== 'string') {
    return null;
  }

  const match = value.match(/(\d+)(?:\.(\d+))?/);
  if (!match) {
    return null;
  }

  const major = Number.parseInt(match[1] ?? '', 10);
  const minor = Number.parseInt(match[2] ?? '0', 10);
  return Number.isFinite(major) && Number.isFinite(minor)
    ? { major, minor }
    : null;
}

function isBelowSupportedBrowserFloor(properties: Properties): boolean {
  const browserName = String(properties.$browser ?? '')
    .trim()
    .toLowerCase();
  const browserVersion = parseBrowserVersion(properties.$browser_version);

  if (!browserName || browserVersion === null) {
    return false;
  }

  const minimumSupportedVersion =
    MIN_SUPPORTED_BROWSER_VERSION_BY_NAME[browserName];

  if (!minimumSupportedVersion) {
    return false;
  }

  return (
    browserVersion.major < minimumSupportedVersion.major ||
    (browserVersion.major === minimumSupportedVersion.major &&
      browserVersion.minor < minimumSupportedVersion.minor)
  );
}

function shouldSuppressClientException(properties: Properties): boolean {
  if (hasSyntheticScriptError(properties)) {
    return true;
  }

  const messages = getExceptionMessages(properties);
  return (
    isBelowSupportedBrowserFloor(properties) &&
    messages.some((message) =>
      REACT_HYDRATION_OR_SUSPENSE_ERROR_PATTERN.test(message)
    )
  );
}

function isPublicBlogUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') {
    return false;
  }

  try {
    const url = new URL(value, globalThis.location?.origin);
    return isPublicBlogPathname(url.pathname, { hostname: url.hostname });
  } catch {
    return false;
  }
}

function getStampedExceptionLocation(
  eventName: string,
  properties: Properties
): BrowserLocationLike | undefined {
  if (
    eventName !== '$exception' ||
    typeof properties.$current_url !== 'string' ||
    properties.$current_url.trim() === ''
  ) {
    return undefined;
  }

  try {
    const currentOrigin = globalThis.location?.origin;
    const url = currentOrigin
      ? new URL(properties.$current_url, currentOrigin)
      : new URL(properties.$current_url);
    return { hostname: url.hostname, pathname: url.pathname };
  } catch {
    return undefined;
  }
}

function getWebVitalsMetricUrls(properties: Properties): string[] {
  return Object.entries(properties)
    .filter(
      ([key, value]) =>
        key.startsWith('$web_vitals_') &&
        key.endsWith('_event') &&
        isRecord(value) &&
        typeof value.$current_url === 'string'
    )
    .map(([, value]) => (value as { $current_url: string }).$current_url);
}

function isPublicBlogWebVitalsEvent(properties: Properties): boolean {
  const metricUrls = getWebVitalsMetricUrls(properties);
  if (metricUrls.length > 0) {
    return metricUrls.some(isPublicBlogUrl);
  }

  if (typeof globalThis.location !== 'undefined') {
    return isPublicBlogPathname(globalThis.location.pathname, {
      hostname: globalThis.location.hostname,
    });
  }

  return false;
}

export function sanitizePostHogProperties(
  properties: Record<string, unknown> | undefined
): Properties | undefined {
  if (!properties) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      sanitizePropertyValue(key, value),
    ])
  ) as Properties;
}

export function sanitizePostHogCapture(
  capture: CaptureResult | null,
  projectToken: string | undefined = getPublicPostHogProjectToken(),
  env: PostHogEnv = process.env
): CaptureResult | null {
  if (!capture) {
    return null;
  }

  const properties = restorePostHogProjectCredentialProperties(
    sanitizePostHogProperties(capture.properties) ?? {},
    projectToken
  );

  if (
    capture.event === '$exception' &&
    shouldSuppressClientException(properties)
  ) {
    return null;
  }

  if (
    WEB_VITALS_EVENT_NAMES.has(capture.event) &&
    isPublicBlogWebVitalsEvent(properties)
  ) {
    return null;
  }

  const tenantLocation =
    getStampedExceptionLocation(capture.event, properties) ??
    (typeof globalThis.location === 'undefined'
      ? undefined
      : globalThis.location);

  if (tenantLocation) {
    for (const key of TENANT_CONTEXT_PROPERTY_KEYS) {
      delete properties[key];
    }

    Object.assign(
      properties,
      resolvePostHogWebTenantContext(env, tenantLocation)
    );
  }

  return {
    ...capture,
    properties,
    $set: sanitizePostHogProperties(capture.$set),
    $set_once: sanitizePostHogProperties(capture.$set_once),
  };
}

export interface PostHogClientConfigOptions {
  /**
   * Strips expensive client-side instrumentation from SEO/content surfaces while
   * preserving manual pageview capture and privacy sanitization.
   */
  lightweight?: boolean;
}

const LIGHTWEIGHT_PUBLIC_BLOG_CONFIG_OVERRIDES: Partial<PostHogConfig> = {
  advanced_disable_flags: true,
  autocapture: false,
  capture_dead_clicks: false,
  capture_heatmaps: false,
  capture_performance: false,
  disable_session_recording: true,
  disable_surveys: true,
  rageclick: false,
};

export function buildPostHogClientConfig(
  env: PostHogEnv = process.env,
  projectToken: string | undefined = getPublicPostHogProjectToken(),
  options: PostHogClientConfigOptions = {}
): Partial<PostHogConfig> {
  const tracingHeaders = getPostHogTracingHeaderHostnames(env);
  const baseConfig: Partial<PostHogConfig> = {
    api_host: getPostHogProxyPath(env),
    ui_host: getPostHogUiHost(env),
    defaults: '2026-05-30',
    advanced_disable_flags: false,
    person_profiles: 'identified_only',
    autocapture: true,
    // Rageclick stays: it rides autocapture's existing document listeners at
    // negligible incremental cost and is a real frustration signal.
    rageclick: true,
    // WEIGHT-B P1 (owner-approved 2026-07-10): dead-clicks and heatmaps are
    // OFF on the storefront. Both attach document-level click instrumentation
    // that showed up in field LoAF click-processing (p75 65ms/click), dead
    // clicks additionally duplicates bundle chunks (known issue), and heatmaps
    // is a run-when-needed UX-research tool, not always-on telemetry — toggle
    // it back on temporarily for specific studies.
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_pageview: false,
    capture_pageleave: false,
    mask_all_text: true,
    mask_all_element_attributes: true,
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    // Keep PostHog's web-vitals autocapture disabled: CWV collection remains
    // handled by WebVitalsReporter so SEO/content routes can drop expensive
    // metrics selectively without leaving extra observers active after SPA
    // transitions.
    capture_performance: false,
    disable_session_recording: false,
    disable_surveys: true,
    session_recording: {
      maskAllInputs: true,
      maskTextFn: () => REDACTED_VALUE,
      maskTextSelector: 'body',
      blockSelector: '[data-ph-block], [data-session-replay-block]',
      sampleRate: SESSION_RECORDING_SAMPLE_RATE,
    },
    // Project credential keys are intentionally absent here:
    // restorePostHogProjectCredentialProperties rewrites token/api_key after
    // sanitization, and blacklisting them would break PostHog ingestion.
    rate_limiting: {
      events_per_second: 8,
      events_burst_limit: 64,
    },
    ...(tracingHeaders.length > 0 ? { tracing_headers: tracingHeaders } : {}),
    property_blacklist: [
      'password',
      'secret',
      'authorization',
      'cookie',
      'otp',
      'pin',
      'cvv',
      'card_number',
      'bvn',
      'nin',
      'email',
      'phone',
      'address',
    ],
    before_send: (capture) =>
      sanitizePostHogCapture(
        dropRecoveredChunkExceptionCapture(capture),
        projectToken,
        env
      ),
    loaded(posthog) {
      posthog.register({
        app_surface: 'web',
        deployment_environment:
          env.NEXT_PUBLIC_VERCEL_ENV || env.NODE_ENV || 'development',
        ...getPostHogReleaseContext(env),
        ...resolvePostHogWebTenantContext(env),
      });
    },
  };

  if (options.lightweight) {
    return { ...baseConfig, ...LIGHTWEIGHT_PUBLIC_BLOG_CONFIG_OVERRIDES };
  }

  return baseConfig;
}
