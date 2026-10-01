import Constants from 'expo-constants';
import PostHog from 'posthog-react-native';
import { createLogger } from '@/lib/logger';
import {
  type AnalyticsProperties,
  sanitizeAnalyticsCaptureEvent,
  sanitizeAnalyticsProperties,
} from './analytics-privacy';
import { buildAnalyticsTracingHostnames } from './analytics-tracing-hostnames';

const log = createLogger('Analytics');

const POSTHOG_API_KEY = Constants.expoConfig?.extra?.posthogApiKey || '';
const POSTHOG_HOST =
  Constants.expoConfig?.extra?.posthogHost || 'https://eu.i.posthog.com';
const APP_VERSION = Constants.expoConfig?.version;
const API_URL = Constants.expoConfig?.extra?.apiUrl;
const MERCHANT_ID = Constants.expoConfig?.extra?.merchantId;
const MERCHANT_SLUG = Constants.expoConfig?.extra?.merchantSlug;
const MERCHANT_DOMAIN = Constants.expoConfig?.extra?.merchantDomain;

let posthogClient: PostHog | null = null;
let analyticsUnavailable = false;
const MAX_PENDING_EVENTS = 50;
const pendingEvents: Array<{
  name: string;
  properties?: Record<string, unknown>;
  timestamp: string;
}> = [];

function getAnalyticsSuperProperties(): AnalyticsProperties {
  return (
    sanitizeAnalyticsProperties({
      app_surface: 'mobile-storefront',
      release_version: APP_VERSION,
      merchant_id: MERCHANT_ID,
      merchant_slug: MERCHANT_SLUG,
      merchant_domain: MERCHANT_DOMAIN,
    }) ?? {}
  );
}

function registerAnalyticsSuperProperties(): void {
  if (!posthogClient) return;
  void posthogClient.register(getAnalyticsSuperProperties());
}

function hasFilteredValue(value: unknown): boolean {
  if (value === '[Filtered]') {
    return true;
  }

  if (typeof value === 'string') {
    return value.includes('[Filtered]');
  }

  if (Array.isArray(value)) {
    return value.some(hasFilteredValue);
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some(hasFilteredValue);
  }

  return false;
}

function sanitizeAnalyticsPersonProperties(
  properties: Record<string, unknown> | undefined
): AnalyticsProperties {
  const sanitized = sanitizeAnalyticsProperties(properties) ?? {};
  return Object.entries(sanitized).reduce<AnalyticsProperties>(
    (filteredProperties, [key, value]) => {
      if (!hasFilteredValue(value)) {
        filteredProperties[key] = value;
      }

      return filteredProperties;
    },
    {}
  );
}

export function initAnalytics(): void {
  if (!POSTHOG_API_KEY) {
    analyticsUnavailable = true;
    log.warn('PostHog API key not configured');
    return;
  }

  try {
    posthogClient = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      addTracingHeaders: buildAnalyticsTracingHostnames({
        apiUrl: API_URL,
        merchantDomain: MERCHANT_DOMAIN,
      }),
      before_send: sanitizeAnalyticsCaptureEvent,
      captureAppLifecycleEvents: true,
      customAppProperties: (properties) => ({
        ...properties,
        ...getAnalyticsSuperProperties(),
      }),
      enableSessionReplay: true,
      sessionReplayConfig: {
        maskAllTextInputs: true,
        maskAllImages: true,
        maskAllSandboxedViews: true,
        captureLog: false,
        captureNetworkTelemetry: false,
        throttleDelayMs: 1000,
      },
      flushAt: 20,
      flushInterval: 30000,
      // Crash/error tracking. Unhandled JS errors and promise rejections are
      // attributed automatically to the user set via identifyUser(), so each
      // crash is tied to the merchant who hit it. Capture also requires the
      // "Enable exception autocapture" toggle in the PostHog project settings.
      // Native iOS/Android crash capture needs @posthog/react-native-plugin,
      // the Expo config plugin, and the PostHog project setting enabled.
      errorTracking: {
        autocapture: {
          uncaughtExceptions: true,
          unhandledRejections: true,
          nativeCrashes: true,
          // Console capture stays off: it would turn third-party/React
          // console.error output into noise (this app's logger is dev-only,
          // so handled errors are not logged in production). To also capture
          // logged errors as exceptions, set `console: ['error']`.
          console: false,
        },
      },
    });

    registerAnalyticsSuperProperties();
    while (pendingEvents.length > 0) {
      const event = pendingEvents.shift();
      if (event) {
        posthogClient.capture(
          event.name,
          {
            ...sanitizeAnalyticsProperties(event.properties),
          },
          { timestamp: new Date(event.timestamp) }
        );
      }
    }

    log.info('PostHog initialized');
  } catch (error) {
    analyticsUnavailable = true;
    pendingEvents.length = 0;
    log.error('Failed to initialize PostHog:', error);
  }
}

export function getPostHog(): PostHog | null {
  return posthogClient;
}

export function identifyUser(
  userId: string,
  properties?: {
    email?: string;
    name?: string;
    phone?: string;
    merchantId?: string;
    loyaltyTier?: string;
    loyaltyPoints?: number;
    createdAt?: string;
  }
): void {
  if (!posthogClient) return;

  posthogClient.identify(userId, {
    ...sanitizeAnalyticsPersonProperties(properties),
    $set_once: {
      first_seen: new Date().toISOString(),
    },
  });
}

export function resetUser(): void {
  if (!posthogClient) return;
  posthogClient.reset();
  registerAnalyticsSuperProperties();
}

export function setUserProperties(
  properties: Record<string, string | number | boolean | null>
): void {
  if (!posthogClient) return;
  const sanitizedProperties = sanitizeAnalyticsPersonProperties(properties);
  if (Object.keys(sanitizedProperties).length === 0) {
    return;
  }

  posthogClient.capture('$set', {
    $set: sanitizedProperties,
  });
}

export function trackEvent(
  eventName: string,
  properties?: Record<string, unknown>
): void {
  if (!posthogClient) {
    if (analyticsUnavailable) return;
    if (pendingEvents.length >= MAX_PENDING_EVENTS) pendingEvents.shift();
    pendingEvents.push({
      name: eventName,
      properties,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  posthogClient.capture(eventName, {
    ...sanitizeAnalyticsProperties(properties),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Manually report a handled error to PostHog error tracking. Unhandled errors
 * are captured automatically; use this in catch blocks for errors you recover
 * from but still want visibility into. Attributed to the user set via
 * {@link identifyUser}; pass `properties` to stamp per-event context.
 */
export function captureException(
  error: unknown,
  properties?: Record<string, string | number | boolean | null>
): void {
  if (!posthogClient) return;

  posthogClient.captureException(
    error,
    sanitizeAnalyticsProperties(properties)
  );
}

export function trackScreen(
  screenName: string,
  properties?: Record<string, unknown>
): void {
  if (!posthogClient) return;

  posthogClient.screen(screenName, {
    ...sanitizeAnalyticsProperties(properties),
    timestamp: new Date().toISOString(),
  });
}

export async function isFeatureEnabled(flagKey: string): Promise<boolean> {
  if (!posthogClient) return false;

  try {
    const value = await posthogClient.isFeatureEnabled(flagKey);
    return value === true;
  } catch {
    return false;
  }
}

export async function getFeatureFlagValue(
  flagKey: string
): Promise<string | boolean | undefined> {
  if (!posthogClient) return undefined;

  try {
    return await posthogClient.getFeatureFlag(flagKey);
  } catch {
    return undefined;
  }
}

export async function reloadFeatureFlags(): Promise<void> {
  if (!posthogClient) return;

  try {
    await posthogClient.reloadFeatureFlags();
  } catch (error) {
    log.error('Failed to reload feature flags:', error);
  }
}

export async function shutdownAnalytics(): Promise<void> {
  if (!posthogClient) return;

  try {
    await posthogClient.flush();
    await posthogClient.shutdown();
    posthogClient = null;
  } catch (error) {
    log.error('Error during shutdown:', error);
  }
}
