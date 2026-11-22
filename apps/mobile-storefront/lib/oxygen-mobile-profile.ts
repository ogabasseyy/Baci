import Constants from 'expo-constants';
import { z } from 'zod';
import { resolveApiBaseUrl } from './api-url';
import { CONFIG } from './config';
import {
  getOxygenStagingProfile,
  type OxygenCapabilityPins,
} from './oxygen-staging-profile';
import { getSupabaseRealtimeConfig } from './supabase';

type OxygenMobileProfile = OxygenCapabilityPins & {
  environment: 'staging' | 'production';
  authBaseUrl: string;
  apiOrigin: string;
  storagePrefix: string;
};

const productionApiOrigin = 'https://usebaci.com';

export function getOxygenMobileProfile(): OxygenMobileProfile | null {
  const staging = getOxygenStagingProfile();
  if (staging) return staging;
  if (
    process.env.EXPO_PUBLIC_OXYGEN_STAGING === '1' ||
    CONFIG.MERCHANT_SLUG !== 'ogabassey' ||
    !z.uuid().safeParse(CONFIG.MERCHANT_ID).success ||
    resolveApiBaseUrl(
      process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl
    ) !== productionApiOrigin
  )
    return null;

  const authBaseUrl = getSupabaseRealtimeConfig()?.url;
  if (!authBaseUrl?.startsWith('https://')) return null;
  const { origin } = new URL(authBaseUrl);
  if (origin !== authBaseUrl) return null;
  return {
    environment: 'production',
    apiOrigin: productionApiOrigin,
    authOrigin: origin,
    authBaseUrl,
    merchantId: CONFIG.MERCHANT_ID,
    merchantSlug: CONFIG.MERCHANT_SLUG,
    storagePrefix: 'oxygen-production:',
  };
}
