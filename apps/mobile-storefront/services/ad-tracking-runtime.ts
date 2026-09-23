import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import {
  getTrackingPermissionStatus,
  requestTrackingPermissionStatus,
} from '@/lib/tracking-transparency';
import {
  hasRequiredAuthorizedAdTrackingModules,
  isFacebookTrackingConfigured,
} from './ad-tracking-authorized-modules';
import {
  FB_APP_ID,
  FB_CLIENT_TOKEN,
  getAdTrackingModules,
  getIsInitialized,
  getIsTikTokInitialized,
  getIsTrackingAllowed,
  IS_TIKTOK_BUSINESS_CONFIGURED,
  initializeTikTokBusinessIfNeeded,
  loadNativeModules,
  adTrackingLog as log,
  setIsInitialized,
  setIsTrackingAllowed,
} from './ad-tracking-state';
import { toTikTokEventData } from './tiktok-event-data';

export const AD_TRACKING_PLATFORM = Platform.OS;

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

// True means the call started without a sync throw; async failures log later.
function runNativeAdModuleCall(label: string, call: () => unknown): boolean {
  try {
    const result = call();
    if (isPromiseLike(result)) {
      void Promise.resolve(result).catch((error: unknown) => {
        log.warn(`${label} failed:`, error);
      });
    }
    return true;
  } catch (error) {
    log.warn(`${label} failed:`, error);
    return false;
  }
}

export async function generateEventId(): Promise<string> {
  const timestamp = Date.now().toString(36);
  const randomBytes = await Crypto.getRandomBytesAsync(8);
  const randomHex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${timestamp}_${randomHex}`;
}

export function generateEventIdSync(): string {
  const timestamp = Date.now().toString(36);
  const cryptoUuid =
    typeof Crypto.randomUUID === 'function' ? Crypto.randomUUID() : null;
  const random =
    typeof cryptoUuid === 'string' && cryptoUuid.length > 0
      ? cryptoUuid.replace(/-/g, '').substring(0, 10)
      : Math.random().toString(36).slice(2, 12).padEnd(10, '0');
  return `${timestamp}_${random}`;
}

async function initializeAuthorizedAdTracking(): Promise<boolean> {
  let modules = getAdTrackingModules();
  const needsFacebookLoad =
    isFacebookTrackingConfigured() && !modules.FBSettings;
  const needsTikTokLoad =
    IS_TIKTOK_BUSINESS_CONFIGURED && !modules.TikTokBusiness;
  if (Platform.OS !== 'web' && (needsFacebookLoad || needsTikTokLoad)) {
    await loadNativeModules();
    modules = getAdTrackingModules();
  }

  if (!hasRequiredAuthorizedAdTrackingModules(modules)) {
    log.warn('Authorized ad SDK modules unavailable after load');
    return false;
  }

  if (Platform.OS === 'ios') {
    runNativeAdModuleCall('Facebook advertiser tracking update', () =>
      modules.FBSettings?.setAdvertiserTrackingEnabled?.(true)
    );
  }

  if (
    FB_APP_ID &&
    FB_CLIENT_TOKEN &&
    typeof modules.FBSettings?.initializeSDK === 'function' &&
    runNativeAdModuleCall('Facebook SDK initialization', () =>
      modules.FBSettings?.initializeSDK?.()
    )
  ) {
    log.info('Facebook SDK initialized (backup)');
  }

  if (
    IS_TIKTOK_BUSINESS_CONFIGURED &&
    modules.TikTokBusiness &&
    !getIsTikTokInitialized()
  ) {
    await initializeTikTokBusinessIfNeeded(modules.TikTokBusiness);
  }

  return true;
}

export async function initAdTracking(): Promise<void> {
  if (getIsInitialized()) return;

  let didInitializeRuntime = false;

  try {
    try {
      if (Platform.OS === 'ios') {
        const { status } = await getTrackingPermissionStatus();
        setIsTrackingAllowed(status === 'granted');
      } else {
        setIsTrackingAllowed(true);
      }
    } catch (error) {
      setIsTrackingAllowed(false);
      log.error('ATT status initialization error:', error);
    }

    if (getIsTrackingAllowed()) {
      try {
        didInitializeRuntime = await initializeAuthorizedAdTracking();
      } catch (error) {
        didInitializeRuntime = false;
        log.error('Authorized ad SDK initialization error:', error);
      }
    } else {
      didInitializeRuntime = true;
    }

    log.info(
      'Initialized. Advertising tracking enabled:',
      getIsTrackingAllowed()
    );
  } finally {
    setIsInitialized(didInitializeRuntime);
  }
}

export async function requestTrackingPermission(): Promise<string> {
  if (Platform.OS !== 'ios') {
    setIsTrackingAllowed(true);
    setIsInitialized(true);
    return 'granted';
  }

  try {
    const wasTrackingAllowed = getIsTrackingAllowed();
    const { status } = await requestTrackingPermissionStatus();
    setIsTrackingAllowed(status === 'granted');

    if (getIsTrackingAllowed() && !wasTrackingAllowed) {
      try {
        const didInitializeAuthorizedTracking =
          await initializeAuthorizedAdTracking();
        setIsInitialized(didInitializeAuthorizedTracking);
      } catch (error) {
        setIsInitialized(false);
        log.error('Authorized ad SDK initialization error:', error);
      }
    } else {
      setIsInitialized(true);
    }

    return status;
  } catch (error) {
    setIsTrackingAllowed(false);
    setIsInitialized(false);
    log.error('ATT request error:', error);
    return 'denied';
  }
}

export function isTrackingEnabled(): boolean {
  return getIsTrackingAllowed();
}

export function sendClientBackup(
  eventId: string,
  fbEvent: string,
  ttEvent: string | null,
  value: number,
  currency: string,
  params: Record<string, unknown>,
  tikTokParams: Record<string, unknown> = params
): void {
  if (!getIsTrackingAllowed()) return;

  const modules = getAdTrackingModules();
  runNativeAdModuleCall('Facebook event log', () =>
    modules.AppEventsLogger?.logEvent?.(fbEvent, value, {
      ...params,
      _eventId: eventId,
    })
  );

  if (Platform.OS === 'ios') {
    runNativeAdModuleCall('Facebook AEM event log', () =>
      modules.AEMReporterIOS?.logAEMEvent?.(fbEvent, value, currency, params)
    );
  }

  trackTikTokEvent(ttEvent, eventId, tikTokParams);
}

export function trackFacebookEvent(
  eventName: string,
  params?: Record<string, unknown>
): void {
  if (!getIsTrackingAllowed()) return;

  runNativeAdModuleCall('Facebook event log', () =>
    getAdTrackingModules().AppEventsLogger?.logEvent?.(eventName, params)
  );
}

export function trackFacebookPurchase(
  value: number,
  currency: string,
  params: Record<string, unknown>
): void {
  if (!getIsTrackingAllowed()) return;

  runNativeAdModuleCall('Facebook purchase log', () =>
    getAdTrackingModules().AppEventsLogger?.logPurchase?.(
      value,
      currency,
      params
    )
  );
}

export function trackAemEvent(
  eventName: string,
  value: number,
  currency: string,
  params: Record<string, unknown>
): void {
  if (Platform.OS === 'ios' && getIsTrackingAllowed()) {
    runNativeAdModuleCall('Facebook AEM event log', () =>
      getAdTrackingModules().AEMReporterIOS?.logAEMEvent?.(
        eventName,
        value,
        currency,
        params
      )
    );
  }
}

export function trackTikTokEvent(
  eventName: string | null,
  eventId: string,
  params?: Record<string, unknown>
): void {
  if (getIsTrackingAllowed() && getIsTikTokInitialized() && eventName) {
    runNativeAdModuleCall('TikTok event log', () =>
      getAdTrackingModules().TikTokBusiness?.trackEvent?.(
        eventName,
        eventId,
        toTikTokEventData(params)
      )
    );
  }
}
