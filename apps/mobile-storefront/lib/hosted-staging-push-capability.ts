import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { isStorefrontTelemetryExcluded } from './storefront-telemetry-excluded';

const PRODUCTION_STOREFRONT_EAS_PROJECT_ID =
  'c6c1897b-cac8-49b0-85f9-3d277aecc379';
const PRODUCTION_STOREFRONT_ANDROID_PACKAGE = 'com.ogabassey.store';
const PRODUCTION_STOREFRONT_IOS_BUNDLE_IDENTIFIER = 'com.ogabassey.app';
const EXPO_PUSH_ORIGIN = 'https://exp.host';
const STAGING_API_ORIGIN = 'https://staging.ogabassey.com';
const STAGING_SUPABASE_ORIGIN = 'https://staging-auth.ogabassey.com';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type NativePlatform = 'android' | 'ios';
type RuntimeEnvironment = {
  apiOrigin: string | undefined;
  applicationId: string | null;
  development: boolean;
  hostedMode: string | undefined;
  supabaseOrigin: string | undefined;
};
type RecordValue = Record<string, unknown>;

export type NativePushRegistration = {
  projectId: string | undefined;
};

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactAllowedOrigins(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 3) return false;
  return (
    value[0] === STAGING_API_ORIGIN &&
    value[1] === STAGING_SUPABASE_ORIGIN &&
    value[2] === EXPO_PUSH_ORIGIN
  );
}

function normalizeProjectId(value: unknown): string | null {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) return null;
  return value.toLowerCase();
}

export function resolveHostedStagingPushCapability(
  expoConfig: unknown,
  platform: NativePlatform,
  environment: RuntimeEnvironment
): { projectId: string } | null {
  if (
    !environment.development ||
    environment.hostedMode !== '1' ||
    environment.apiOrigin !== STAGING_API_ORIGIN ||
    environment.supabaseOrigin !== STAGING_SUPABASE_ORIGIN ||
    !isRecord(expoConfig)
  ) {
    return null;
  }

  const extra = expoConfig.extra;
  const eas = isRecord(extra) ? extra.eas : null;
  const capability = isRecord(extra) ? extra.hostedStagingPush : null;
  const ios = expoConfig.ios;
  const android = expoConfig.android;
  const capabilityProjectId = isRecord(capability)
    ? normalizeProjectId(capability.projectId)
    : null;
  const manifestProjectId = isRecord(eas)
    ? normalizeProjectId(eas.projectId)
    : null;
  const expectedApplicationId =
    isRecord(capability) &&
    typeof capability.iosBundleIdentifier === 'string' &&
    typeof capability.androidPackage === 'string'
      ? platform === 'ios'
        ? capability.iosBundleIdentifier
        : capability.androidPackage
      : null;
  const installedApplicationId = environment.applicationId?.toLowerCase();
  if (
    !isRecord(extra) ||
    extra.hostedStorefront !== true ||
    !isRecord(eas) ||
    !isRecord(capability) ||
    !capabilityProjectId ||
    !manifestProjectId ||
    capabilityProjectId === PRODUCTION_STOREFRONT_EAS_PROJECT_ID ||
    manifestProjectId !== capabilityProjectId ||
    !hasExactAllowedOrigins(capability.allowedOrigins) ||
    !isRecord(ios) ||
    !isRecord(android) ||
    typeof capability.iosBundleIdentifier !== 'string' ||
    typeof capability.androidPackage !== 'string' ||
    capability.iosBundleIdentifier.toLowerCase() ===
      PRODUCTION_STOREFRONT_IOS_BUNDLE_IDENTIFIER ||
    capability.androidPackage.toLowerCase() ===
      PRODUCTION_STOREFRONT_ANDROID_PACKAGE ||
    ios.bundleIdentifier !== capability.iosBundleIdentifier ||
    android.package !== capability.androidPackage ||
    !expectedApplicationId ||
    !installedApplicationId ||
    installedApplicationId !== expectedApplicationId.toLowerCase() ||
    installedApplicationId === PRODUCTION_STOREFRONT_IOS_BUNDLE_IDENTIFIER ||
    installedApplicationId === PRODUCTION_STOREFRONT_ANDROID_PACKAGE
  ) {
    return null;
  }

  if (
    (platform === 'ios' && !capability.iosBundleIdentifier) ||
    (platform === 'android' && !capability.androidPackage)
  ) {
    return null;
  }

  return { projectId: capabilityProjectId };
}

export function getNativePushRegistration(): NativePushRegistration | null {
  const telemetryExcluded = isStorefrontTelemetryExcluded();
  if (!telemetryExcluded) {
    const extra = isRecord(Constants.expoConfig)
      ? Constants.expoConfig.extra
      : null;
    const eas = isRecord(extra) ? extra.eas : null;
    const projectId =
      isRecord(eas) && typeof eas.projectId === 'string'
        ? eas.projectId
        : undefined;
    return {
      projectId,
    };
  }
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
  return resolveHostedStagingPushCapability(Constants.expoConfig, Platform.OS, {
    apiOrigin: process.env.EXPO_PUBLIC_API_URL,
    applicationId: Application.applicationId,
    development: typeof __DEV__ !== 'undefined' && __DEV__,
    hostedMode: process.env.EXPO_PUBLIC_HOSTED_STOREFRONT,
    supabaseOrigin: process.env.EXPO_PUBLIC_SUPABASE_URL,
  });
}
