import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';
import { normalizeTikTokEventData, type TikTokEventData } from './event-data';

export type { TikTokEventData } from './event-data';

export enum TikTokTrackingAuthorizationStatus {
  NotDetermined = 0,
  Restricted = 1,
  Denied = 2,
  Authorized = 3,
}

export interface TikTokBusinessPluginConfig {
  ios: {
    appId: string;
    tiktokAppId: string;
    autoInitialize?: boolean;
    debugMode?: boolean;
    disablePaymentTracking?: boolean;
    disableSKAdNetworkSupport?: boolean;
  } & (
    | { appSecret: string; appSecretEnvVar?: never }
    | { appSecret?: never; appSecretEnvVar: string }
  );
}

export type TikTokBusinessPlugin = [
  '@baci/tiktok-business/plugin',
  TikTokBusinessPluginConfig,
];

interface BaciTikTokBusinessNativeModule {
  initialize: () => Promise<boolean>;
  isInitialized: () => boolean;
  identify: (
    externalID: string,
    externalUserName?: string,
    phoneNumber?: string,
    email?: string
  ) => void;
  logout: () => void;
  isDebugMode: () => boolean;
  trackEvent: (
    eventName: string,
    eventId?: string,
    eventData?: Array<{ key: string; value: string }> | null
  ) => boolean;
  flush: () => void;
  requestTrackingAuthorization: () => Promise<TikTokTrackingAuthorizationStatus>;
}

let nativeModule: BaciTikTokBusinessNativeModule | null | undefined;

function getNativeModule(): BaciTikTokBusinessNativeModule | null {
  if (Platform.OS !== 'ios') {
    return null;
  }

  if (nativeModule !== undefined) {
    return nativeModule;
  }

  try {
    nativeModule =
      requireNativeModule<BaciTikTokBusinessNativeModule>('BaciTikTokBusiness');
  } catch {
    nativeModule = null;
  }

  return nativeModule;
}

export async function initialize(): Promise<boolean> {
  return (await getNativeModule()?.initialize()) ?? false;
}

export function isInitialized(): boolean {
  return getNativeModule()?.isInitialized() ?? false;
}

export function identify(
  externalID: string,
  externalUserName?: string,
  phoneNumber?: string,
  email?: string
): void {
  getNativeModule()?.identify(externalID, externalUserName, phoneNumber, email);
}

export function logout(): void {
  getNativeModule()?.logout();
}

export function isDebugMode(): boolean {
  return getNativeModule()?.isDebugMode() ?? false;
}

export function trackEvent(
  eventName: string,
  eventId?: string,
  eventData?: TikTokEventData[] | null
): boolean {
  return (
    getNativeModule()?.trackEvent(
      eventName,
      eventId,
      normalizeTikTokEventData(eventData)
    ) ?? false
  );
}

export function flush(): void {
  getNativeModule()?.flush();
}

export function requestTrackingAuthorization(): Promise<TikTokTrackingAuthorizationStatus | null> {
  return (
    getNativeModule()?.requestTrackingAuthorization() ?? Promise.resolve(null)
  );
}

const TikTokBusiness = {
  flush,
  identify,
  initialize,
  isDebugMode,
  isInitialized,
  logout,
  requestTrackingAuthorization,
  trackEvent,
};

export default TikTokBusiness;
