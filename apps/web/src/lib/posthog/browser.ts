import posthog from 'posthog-js';
import { markPostHogBrowserInitialized } from '@/lib/posthog/browser-state';
import { connectClientEventSink } from '@/lib/posthog/capture-client-event';
import { buildPostHogClientConfig } from '@/lib/posthog/client-config';
import type { PostHogEnv } from '@/lib/posthog/config';
import { pendingClientExceptionQueue } from '@/lib/posthog/pending-client-exception-queue';
import { isPublicBlogPathname } from '@/lib/posthog/public-blog-path';
import {
  clearPendingPostHogWebVitals,
  drainPendingPostHogWebVitals,
  enqueuePostHogWebVital,
  type PostHogWebVitalsPayload,
} from '@/lib/posthog/web-vitals-queue';

const MISSING_TOKEN_WARNING =
  '[PostHog] NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is missing; web analytics and error capture are disabled.';
const POSTHOG_NODE_ENV = process.env.NODE_ENV;
const POSTHOG_PAGEVIEW_CAPTURE_OPTIONS = { send_instantly: true } as const;
const POSTHOG_LOADED_STATE_CHECK_INTERVAL_MS = 250;
const POSTHOG_LOADED_STATE_CHECK_ATTEMPTS = 40;

let hasInitializedPostHogBrowser = false;
let lastConfiguredPostHogLightweight: boolean | undefined;
let isPostHogReadyForCapture = false;
let isPostHogBrowserDisabled = false;
let lastCapturedPostHogPageviewUrl: string | undefined;
let postHogLoadedStateCheckAttempts = 0;
let postHogLoadedStateCheckTimer:
  | ReturnType<typeof globalThis.setTimeout>
  | undefined;
type PageviewExtraProperties = Record<string, string | undefined> | object;

interface PendingPostHogPageview {
  url: string;
  properties?: PageviewExtraProperties;
}
const pendingPostHogPageviews: PendingPostHogPageview[] = [];

function isPostHogDevelopmentMode(env: PostHogEnv): boolean {
  return (env.NODE_ENV ?? POSTHOG_NODE_ENV) === 'development';
}

export interface InitializePostHogBrowserOptions {
  lightweight?: boolean;
  pathname?: string;
  hostname?: string;
}

function isLightweightPostHogSurface(
  options: InitializePostHogBrowserOptions = {}
): boolean {
  if (options.lightweight !== undefined) {
    return options.lightweight;
  }

  const pathname =
    options.pathname ||
    (typeof globalThis.location === 'undefined'
      ? undefined
      : globalThis.location.pathname);

  if (!pathname) {
    return false;
  }

  return isPublicBlogPathname(pathname, {
    hostname:
      options.hostname ||
      (typeof globalThis.location === 'undefined'
        ? undefined
        : globalThis.location.hostname),
  });
}

type PostHogBrowserClientConfig = ReturnType<typeof buildPostHogClientConfig>;

function splitPostHogInitConfig(clientConfig: PostHogBrowserClientConfig) {
  const { advanced_disable_flags: advancedDisableFlags, ...initConfig } =
    clientConfig;

  return { advancedDisableFlags, initConfig };
}

type PostHogLoadedInstance = Parameters<
  NonNullable<PostHogBrowserClientConfig['loaded']>
>[0];

function applyPostHogFlagDisableConfig(
  posthogInstance: PostHogLoadedInstance,
  advancedDisableFlags: PostHogBrowserClientConfig['advanced_disable_flags'],
  expectedLightweight: boolean
) {
  if (
    advancedDisableFlags === true &&
    lastConfiguredPostHogLightweight === expectedLightweight
  ) {
    posthogInstance.set_config({ advanced_disable_flags: true });
  }
}

function isLeavingLightweightPostHogMode(
  previousLightweight: boolean | undefined,
  nextLightweight: boolean
) {
  return previousLightweight === true && nextLightweight === false;
}

function maybeReloadPostHogFeatureFlags(
  previousLightweight: boolean | undefined,
  nextLightweight: boolean
) {
  if (isLeavingLightweightPostHogMode(previousLightweight, nextLightweight)) {
    posthog.reloadFeatureFlags();
  }
}

function maybeReloadPostHogRemoteConfig(
  previousLightweight: boolean | undefined,
  nextLightweight: boolean
) {
  if (isLeavingLightweightPostHogMode(previousLightweight, nextLightweight)) {
    posthog._remoteConfigLoader?.load();
  }
}

export function initializePostHogBrowser(
  env: PostHogEnv = process.env,
  logger: Pick<Console, 'warn'> = console,
  options: InitializePostHogBrowserOptions = {}
) {
  const projectToken = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();

  if (!projectToken) {
    isPostHogBrowserDisabled = true;
    clearPostHogLoadedStateCheck();
    pendingPostHogPageviews.length = 0;
    pendingClientExceptionQueue.clear();
    clearPendingPostHogWebVitals();

    if (isPostHogDevelopmentMode(env)) {
      logger.warn(MISSING_TOKEN_WARNING);
    }
    return;
  }

  isPostHogBrowserDisabled = false;

  const lightweight = isLightweightPostHogSurface(options);

  if (hasInitializedPostHogBrowser) {
    if (lastConfiguredPostHogLightweight !== lightweight) {
      const clientConfig = buildPostHogClientConfig(env, projectToken, {
        lightweight,
      });
      const { loaded: _loaded, ...runtimeConfig } = clientConfig;
      const previousLightweight = lastConfiguredPostHogLightweight;
      posthog.set_config(runtimeConfig);
      lastConfiguredPostHogLightweight = lightweight;
      maybeReloadPostHogRemoteConfig(previousLightweight, lightweight);
      maybeReloadPostHogFeatureFlags(previousLightweight, lightweight);
    }
    return;
  }

  const clientConfig = buildPostHogClientConfig(env, projectToken, {
    lightweight,
  });
  const { advancedDisableFlags, initConfig } =
    splitPostHogInitConfig(clientConfig);
  const clientLoaded = clientConfig.loaded;

  try {
    lastConfiguredPostHogLightweight = lightweight;
    posthog.init(projectToken, {
      ...initConfig,
      loaded(posthogInstance) {
        applyPostHogFlagDisableConfig(
          posthogInstance,
          advancedDisableFlags,
          lightweight
        );

        try {
          clientLoaded?.(posthogInstance);
        } catch (error) {
          if (isPostHogDevelopmentMode(env)) {
            logger.warn('[PostHog] client loaded callback failed.', error);
          }
        }

        markPostHogReadyAndFlush();
      },
    });
    hasInitializedPostHogBrowser = true;
    markPostHogBrowserInitialized();
    postHogLoadedStateCheckAttempts = 0;
    flushPendingPostHogPageviewsIfClientLoaded();
    flushPendingPostHogWebVitals();
    schedulePostHogLoadedStateCheck();
  } catch (error) {
    isPostHogReadyForCapture = false;
    lastConfiguredPostHogLightweight = undefined;
    throw error;
  }
}

function flushPendingClientExceptions(): void {
  for (const queuedException of pendingClientExceptionQueue.drain()) {
    try {
      posthog.captureException(
        queuedException.error,
        queuedException.properties
      );
    } catch {
      // Keep the claimed entry durable for a later successful initialization.
      pendingClientExceptionQueue.restore(queuedException);
    }
  }
}

function resolvePostHogPageviewUrl(currentUrl?: string) {
  const resolvedUrl =
    currentUrl ||
    (typeof globalThis.location === 'undefined'
      ? undefined
      : globalThis.location.href);

  return resolvedUrl;
}

function queuePostHogPageview(
  resolvedUrl: string,
  properties?: PageviewExtraProperties
) {
  const lastPending =
    pendingPostHogPageviews[pendingPostHogPageviews.length - 1];
  if (
    !lastPending ||
    lastPending.url !== resolvedUrl ||
    lastPending.properties !== properties
  ) {
    pendingPostHogPageviews.push({ url: resolvedUrl, properties });
  }

  flushPendingPostHogPageviewsIfClientLoaded();
  schedulePostHogLoadedStateCheck();
}

function isPostHogClientLoaded() {
  // The public PostHog path is the `loaded` callback above. `posthog-js@1.387.0`
  // also exposes `__loaded` in its bundled TypeScript definitions; use it only as
  // a fallback for missed callback races, and re-check this line during SDK bumps.
  return posthog.__loaded === true;
}

function markPostHogReadyAndFlush() {
  if (isPostHogReadyForCapture) {
    return;
  }

  isPostHogReadyForCapture = true;
  clearPostHogLoadedStateCheck();
  flushPendingClientExceptions();
  flushPendingPostHogPageviews();
  // Product events (wallet funding funnel etc.) captured before init queue in
  // the capture helper — connect the live sink and drain them.
  connectClientEventSink((event, properties) => {
    posthog.capture(event, properties);
  });
}

function clearPostHogLoadedStateCheck() {
  if (postHogLoadedStateCheckTimer === undefined) {
    return;
  }

  globalThis.clearTimeout(postHogLoadedStateCheckTimer);
  postHogLoadedStateCheckTimer = undefined;
}

function schedulePostHogLoadedStateCheck() {
  if (
    postHogLoadedStateCheckTimer !== undefined ||
    isPostHogReadyForCapture ||
    !hasInitializedPostHogBrowser ||
    pendingPostHogPageviews.length === 0 ||
    postHogLoadedStateCheckAttempts >= POSTHOG_LOADED_STATE_CHECK_ATTEMPTS
  ) {
    return;
  }

  postHogLoadedStateCheckTimer = globalThis.setTimeout(() => {
    postHogLoadedStateCheckTimer = undefined;
    flushPendingPostHogPageviewsIfClientLoaded();

    if (isPostHogReadyForCapture || pendingPostHogPageviews.length === 0) {
      return;
    }

    postHogLoadedStateCheckAttempts += 1;
    schedulePostHogLoadedStateCheck();
  }, POSTHOG_LOADED_STATE_CHECK_INTERVAL_MS);
}

function flushPendingPostHogPageviewsIfClientLoaded() {
  if (isPostHogReadyForCapture || !isPostHogClientLoaded()) {
    return;
  }

  markPostHogReadyAndFlush();
}

function flushPendingPostHogPageviews() {
  const pendingPageviews = pendingPostHogPageviews.splice(0);

  for (const pending of pendingPageviews) {
    sendPostHogPageview(pending.url, pending.properties);
  }
}

function sendPostHogPageview(
  resolvedUrl: string,
  properties?: PageviewExtraProperties
) {
  if (lastCapturedPostHogPageviewUrl === resolvedUrl) {
    return;
  }

  lastCapturedPostHogPageviewUrl = resolvedUrl;
  posthog.capture(
    '$pageview',
    {
      $current_url: resolvedUrl,
      app_surface: 'web',
      ...properties,
    },
    POSTHOG_PAGEVIEW_CAPTURE_OPTIONS
  );
}

export function capturePostHogPageview(
  currentUrl?: string,
  properties?: PageviewExtraProperties
) {
  if (isPostHogBrowserDisabled) {
    return;
  }

  const resolvedUrl = resolvePostHogPageviewUrl(currentUrl);

  if (!resolvedUrl) {
    return;
  }

  if (!hasInitializedPostHogBrowser || !isPostHogReadyForCapture) {
    queuePostHogPageview(resolvedUrl, properties);
    return;
  }

  sendPostHogPageview(resolvedUrl, properties);
}

export type { PostHogWebVitalsPayload };

/**
 * Emits a single flat `web_vitals` event for a Core Web Vitals report. When the
 * browser client has not been initialized yet the payload is buffered (rather
 * than dropped) so early metrics — TTFB/FCP fire before the idle boot — flush
 * once init runs; it never boots PostHog on its own. Once init has been called,
 * posthog-js buffers the capture via its own request queue even before the
 * `loaded` callback fires. The `before_send` sanitizer still runs at capture
 * time on every flushed event, so blog/SEO drop rules keep applying.
 */
export function capturePostHogWebVitals(payload: PostHogWebVitalsPayload) {
  if (isPostHogBrowserDisabled) {
    return;
  }

  if (!hasInitializedPostHogBrowser) {
    enqueuePostHogWebVital(payload);
    return;
  }

  // Buffered payloads carry the origin `$current_url`/`$pathname` stamped at
  // enqueue time (see `withOriginUrl` in web-vitals-queue.ts); passing them here
  // overrides the LATER page posthog-js would otherwise attribute post-flush.
  posthog.capture('web_vitals', payload);
}

function flushPendingPostHogWebVitals() {
  for (const payload of drainPendingPostHogWebVitals()) {
    capturePostHogWebVitals(payload);
  }
}
