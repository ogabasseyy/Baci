import { HostedStagingPushPreflightInputSchema } from '../schemas/hosted-staging-push-preflight.mjs';
import capabilityValidation from './hosted-staging-push-capability.js';

const { validateHostedStagingPushCapability } = capabilityValidation;
const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function evaluateHostedStagingPushPreflight(input) {
  const inputResult = HostedStagingPushPreflightInputSchema.safeParse(input);
  if (!inputResult.success)
    return { ready: false, blockers: ['Invalid preflight input'] };
  const {
    pins,
    easConfig,
    manifest,
    installedApplicationId,
    installedPlatform,
  } = inputResult.data;
  if (
    !isRecord(pins) ||
    pins.apiOrigin !== 'https://staging.ogabassey.com' ||
    pins.supabaseOrigin !== 'https://staging-auth.ogabassey.com' ||
    !isRecord(easConfig) ||
    !isRecord(easConfig.build)
  )
    return {
      ready: false,
      blockers: ['Local staging configuration is invalid'],
    };
  const blockers = [];
  const identity = pins.nativeStagingPush;
  const validation = validateHostedStagingPushCapability(identity, pins);
  if (!validation.valid) blockers.push(validation.blocker);

  const profile = easConfig.build['hosted-staging-push'];
  if (!isRecord(profile)) {
    blockers.push('No hosted-staging-push EAS profile is configured');
  } else {
    const env = isRecord(profile.env) ? profile.env : {};
    if (
      profile.distribution !== 'internal' ||
      env.EXPO_PUBLIC_HOSTED_STOREFRONT !== '1' ||
      env.EXPO_PUBLIC_API_URL !== pins.apiOrigin ||
      env.EXPO_PUBLIC_SUPABASE_URL !== pins.supabaseOrigin ||
      env.EXPO_PUBLIC_POSTHOG_API_KEY !== ''
    )
      blockers.push(
        'The EAS profile is not isolated to staging with analytics disabled'
      );
  }

  if (manifest === undefined) {
    blockers.push('A resolved Expo manifest is required for build readiness');
  } else if (
    typeof manifest?.ios?.bundleIdentifier !== 'string' ||
    !manifest.ios.bundleIdentifier ||
    typeof manifest?.android?.package !== 'string' ||
    !manifest.android.package ||
    typeof manifest?.extra?.eas?.projectId !== 'string' ||
    !validateHostedStagingPushCapability(
      manifest?.extra?.hostedStagingPush,
      pins
    ).valid ||
    manifest.extra.hostedStorefront !== true ||
    typeof manifest.extra.apiUrl !== 'string' ||
    typeof manifest.extra.supabaseUrl !== 'string' ||
    manifest.extra.posthogApiKey !== '' ||
    manifest.extra.facebookAppId !== '' ||
    manifest.extra.facebookClientToken !== '' ||
    manifest.extra.tiktokBusiness?.isConfigured !== false ||
    manifest.updates?.enabled !== false
  ) {
    blockers.push(
      'The resolved Expo manifest is incomplete or enables analytics'
    );
  } else if (validation.valid) {
    if (
      manifest.extra.eas.projectId !== identity.projectId ||
      manifest.extra.hostedStagingPush.projectId !== identity.projectId ||
      manifest.extra.hostedStagingPush.iosBundleIdentifier !==
        identity.iosBundleIdentifier ||
      manifest.extra.hostedStagingPush.androidPackage !==
        identity.androidPackage ||
      manifest.ios.bundleIdentifier !== identity.iosBundleIdentifier ||
      manifest.android.package !== identity.androidPackage ||
      manifest.extra.apiUrl !== pins.apiOrigin ||
      manifest.extra.supabaseUrl !== pins.supabaseOrigin
    )
      blockers.push('The resolved Expo manifest does not match staging pins');
    const expectedId =
      installedPlatform === 'ios'
        ? identity.iosBundleIdentifier
        : identity.androidPackage;
    if (
      installedApplicationId &&
      installedApplicationId.toLowerCase() !== expectedId.toLowerCase()
    )
      blockers.push(
        'The installed application identity does not match staging pins'
      );
  }
  if (!installedApplicationId)
    blockers.push('The installed application identity is required');
  return { ready: blockers.length === 0, blockers };
}
