import Constants from 'expo-constants';
import { createLogger } from '@/lib/logger';
import type { AdTrackingUserProperties } from './ad-tracking.types';
import {
  type AEMReporterIOSLike,
  type AppEventsLoggerLike,
  type FBSettingsLike,
  loadAdTrackingNativeModules,
  type TikTokBusinessLike,
} from './ad-tracking-native-modules';

export const adTrackingLog = createLogger('AdTracking');

export const FB_APP_ID = Constants.expoConfig?.extra?.facebookAppId || '';
export const FB_CLIENT_TOKEN =
  Constants.expoConfig?.extra?.facebookClientToken || '';
const TIKTOK_BUSINESS_CONFIG = Constants.expoConfig?.extra?.tiktokBusiness as
  | { isConfigured?: boolean; iosTikTokAppId?: string | null }
  | undefined;
export const IS_TIKTOK_BUSINESS_CONFIGURED = Boolean(
  TIKTOK_BUSINESS_CONFIG?.isConfigured
);
export const AD_API_URL =
  Constants.expoConfig?.extra?.apiUrl || 'https://ogabassey.com/api';

let FBSettings: FBSettingsLike | null = null;
let AppEventsLogger: AppEventsLoggerLike | null = null;
let AEMReporterIOS: AEMReporterIOSLike | null = null;
let TikTokBusiness: TikTokBusinessLike | null = null;

let isTrackingAllowed = false;
let isInitialized = false;
let isTikTokInitialized = false;
let cachedMerchantId: string | null = null;
let cachedUserData: AdTrackingUserProperties & { userId?: string } = {};

export async function loadNativeModules(): Promise<void> {
  // Assign TikTok early and initialize it concurrently with Facebook load so
  // either provider stalling cannot block the other after the 4s deadline.
  const modules = await loadAdTrackingNativeModules({
    onTikTokReady: async (tikTok) => {
      TikTokBusiness = tikTok;
      await initializeTikTokBusinessIfNeeded(tikTok);
    },
  });
  FBSettings = modules.FBSettings;
  AppEventsLogger = modules.AppEventsLogger;
  AEMReporterIOS = modules.AEMReporterIOS;
  TikTokBusiness = modules.TikTokBusiness;
}

/** Initializes TikTok when configured; safe to call before Facebook finishes. */
export async function initializeTikTokBusinessIfNeeded(
  tikTok: TikTokBusinessLike | null = TikTokBusiness
): Promise<void> {
  if (!IS_TIKTOK_BUSINESS_CONFIGURED || !tikTok || getIsTikTokInitialized()) {
    return;
  }

  try {
    const initialized = await tikTok.initialize?.();
    setIsTikTokInitialized(Boolean(initialized || tikTok.isInitialized?.()));
    if (getIsTikTokInitialized()) {
      adTrackingLog.info('TikTok SDK initialized');
    }
  } catch (error) {
    setIsTikTokInitialized(false);
    adTrackingLog.warn('TikTok SDK initialization failed:', error);
  }
}

export function getAdTrackingModules() {
  return { FBSettings, AppEventsLogger, AEMReporterIOS, TikTokBusiness };
}

export function setMerchantId(merchantId: string): void {
  cachedMerchantId = merchantId;
}

export function getCachedMerchantId(): string | null {
  return cachedMerchantId;
}

export function setCachedUserData(
  userId: string,
  properties?: AdTrackingUserProperties
): void {
  cachedUserData = {
    userId,
    email: properties?.email,
    phone: properties?.phone,
    firstName: properties?.firstName,
    lastName: properties?.lastName,
  };
}

export function clearCachedUserData(): void {
  cachedUserData = {};
}

export function getCachedUserData() {
  return cachedUserData;
}

export function getIsTrackingAllowed(): boolean {
  return isTrackingAllowed;
}

export function setIsTrackingAllowed(value: boolean): void {
  isTrackingAllowed = value;
}

export function getIsInitialized(): boolean {
  return isInitialized;
}

export function setIsInitialized(value: boolean): void {
  isInitialized = value;
}

export function getIsTikTokInitialized(): boolean {
  if (!isTikTokInitialized) {
    try {
      isTikTokInitialized = Boolean(TikTokBusiness?.isInitialized?.());
    } catch (error) {
      adTrackingLog.warn('TikTok SDK readiness check failed:', error);
    }
  }
  return isTikTokInitialized;
}

export function setIsTikTokInitialized(value: boolean): void {
  isTikTokInitialized = value;
}
