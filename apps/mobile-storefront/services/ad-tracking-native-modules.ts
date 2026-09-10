import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { loadFacebookTrackingModules } from './load-facebook-tracking-modules';
import type { TikTokEventData } from './tiktok-event-data';

export interface FBSettingsLike {
  initializeSDK: () => void | Promise<boolean>;
  setAdvertiserTrackingEnabled: (enabled: boolean) => void;
}

export interface AppEventsLoggerLike {
  logEvent: {
    (name: string, params?: Record<string, unknown>): void;
    (name: string, valueToSum: number, params?: Record<string, unknown>): void;
  };
  logPurchase: (
    amount: number,
    currency: string,
    params?: Record<string, unknown>
  ) => void;
  setUserData: (data: Record<string, string | undefined>) => void;
  clearUserID: () => void;
}

export interface AEMReporterIOSLike {
  logAEMEvent: (
    name: string,
    value: number,
    currency: string,
    params: Record<string, unknown>
  ) => void;
}

export interface TikTokBusinessLike {
  initialize?: () => boolean | Promise<boolean>;
  isInitialized?: () => boolean;
  identify?: (
    externalID: string,
    externalUserName?: string,
    phoneNumber?: string,
    email?: string
  ) => void;
  logout?: () => void;
  trackEvent: (
    name: string,
    eventId?: string,
    eventData?: TikTokEventData[]
  ) => void;
}

export interface AdTrackingNativeModules {
  FBSettings: FBSettingsLike | null;
  AppEventsLogger: AppEventsLoggerLike | null;
  AEMReporterIOS: AEMReporterIOSLike | null;
  TikTokBusiness: TikTokBusinessLike | null;
}

export type LoadAdTrackingNativeModulesOptions = {
  /** Fired when TikTok is loaded; may run concurrently with Facebook initializeSDK. */
  onTikTokReady?: (tikTok: TikTokBusinessLike | null) => void | Promise<void>;
};

async function loadTikTokBusinessModule(): Promise<TikTokBusinessLike | null> {
  try {
    const tt = await import('@baci/tiktok-business');
    return (tt.default || tt) as unknown as TikTokBusinessLike;
  } catch (error) {
    console.debug(
      '[AdTracking] TikTok native module ignored or failed to load:',
      error
    );
    return null;
  }
}

export async function loadAdTrackingNativeModules(
  options: LoadAdTrackingNativeModulesOptions = {}
): Promise<AdTrackingNativeModules> {
  const modules: AdTrackingNativeModules = {
    FBSettings: null,
    AppEventsLogger: null,
    AEMReporterIOS: null,
    TikTokBusiness: null,
  };
  if (Platform.OS === 'web') return modules;

  // Load TikTok first, then run its ready callback concurrently with Facebook
  // so a stalled TikTok initialize cannot leave FBSettings null.
  modules.TikTokBusiness = await loadTikTokBusinessModule();
  const tikTokReady = Promise.resolve(
    options.onTikTokReady?.(modules.TikTokBusiness)
  ).catch((error: unknown) => {
    console.debug(
      '[AdTracking] TikTok onTikTokReady ignored or failed:',
      error
    );
  });

  try {
    if (
      Constants.expoConfig?.extra?.facebookAppId &&
      Constants.expoConfig?.extra?.facebookClientToken
    ) {
      const fb = await loadFacebookTrackingModules(
        Constants.expoConfig.extra.facebookAppId,
        Constants.expoConfig.extra.facebookClientToken
      );
      modules.FBSettings = fb.settings as FBSettingsLike;
      modules.AppEventsLogger = fb.events as AppEventsLoggerLike;
      modules.AEMReporterIOS = fb.aem as AEMReporterIOSLike;
    }
  } catch (error) {
    console.debug(
      '[AdTracking] Facebook native modules ignored or failed to load:',
      error
    );
  }

  await tikTokReady;
  return modules;
}
