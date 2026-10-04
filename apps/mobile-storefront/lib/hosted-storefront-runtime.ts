import type { SupabaseClient } from '@supabase/supabase-js';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { resolveHostedStagingPushCapability } from './hosted-staging-push-capability';
import { createHostedStorefrontAppFetch } from './hosted-storefront-app-fetch';
import { getHostedStorefrontConfiguration } from './hosted-storefront-configuration';
import { installHostedStorefrontRuntime } from './install-hosted-storefront-runtime';

type Runtime = Awaited<
  ReturnType<typeof installHostedStorefrontRuntime<SupabaseClient>>
>;
type Dependencies = Parameters<
  typeof installHostedStorefrontRuntime<SupabaseClient>
>[2];
type BuildProfile = {
  apiOrigin: string;
  supabaseOrigin: string;
  merchantId: string;
};
let installed: Runtime | undefined;
let attempted = false;

function assertBuild(profile: BuildProfile, publicKey: string): void {
  const extra = Constants.expoConfig?.extra;
  const platform = Platform.OS;
  const nativeStagingPush =
    platform === 'android' || platform === 'ios'
      ? resolveHostedStagingPushCapability(Constants.expoConfig, platform, {
          apiOrigin: profile.apiOrigin,
          applicationId: Application.applicationId,
          development: typeof __DEV__ !== 'undefined' && __DEV__,
          hostedMode: process.env.EXPO_PUBLIC_HOSTED_STOREFRONT,
          supabaseOrigin: profile.supabaseOrigin,
        })
      : null;
  const hasNativeStagingPushConfiguration = Boolean(
    extra?.eas?.projectId || extra?.hostedStagingPush
  );
  if (
    typeof __DEV__ === 'undefined' ||
    !__DEV__ ||
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT !== '1' ||
    ![undefined, '', '0'].includes(process.env.EXPO_PUBLIC_LOCAL_STOREFRONT) ||
    ![undefined, '', '0'].includes(process.env.EXPO_PUBLIC_PHONE_QA) ||
    process.env.EXPO_PUBLIC_API_URL !== profile.apiOrigin ||
    process.env.EXPO_PUBLIC_SUPABASE_URL !== profile.supabaseOrigin ||
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY !== publicKey ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== publicKey ||
    process.env.EXPO_PUBLIC_MERCHANT_ID !== profile.merchantId ||
    extra?.apiUrl !== profile.apiOrigin ||
    extra.supabaseUrl !== profile.supabaseOrigin ||
    extra.supabasePublishableKey !== publicKey ||
    extra.supabaseAnonKey !== publicKey ||
    extra.merchantId !== profile.merchantId ||
    extra.localStorefront ||
    extra.posthogApiKey ||
    extra.facebookAppId ||
    extra.facebookClientToken ||
    extra.tiktokBusiness?.isConfigured ||
    (hasNativeStagingPushConfiguration && !nativeStagingPush) ||
    Constants.expoConfig?.updates?.enabled !== false ||
    process.env.EXPO_PUBLIC_SENTRY_DSN
  )
    throw new Error(
      'Hosted staging requires a matching sanitized development build'
    );
}

export const hostedStorefrontRuntime = Object.freeze({
  async start(
    profile: unknown,
    publicKey: string,
    dependencies: Dependencies
  ): Promise<void> {
    await hostedStorefrontRuntime.install(profile, publicKey, dependencies);
    require('../index');
  },
  async install(
    profile: unknown,
    publicKey: string,
    dependencies: Dependencies
  ): Promise<Runtime> {
    if (attempted)
      throw new Error('Fully reload before installing another hosted runtime');
    attempted = true;
    const configuration = getHostedStorefrontConfiguration(
      profile,
      typeof __DEV__ !== 'undefined' && __DEV__,
      {
        supabaseOrigins: ['https://staging-auth.ogabassey.com'],
      }
    );
    assertBuild(configuration, publicKey);
    const runtime = await installHostedStorefrontRuntime(profile, publicKey, {
      ...dependencies,
      transport: createHostedStorefrontAppFetch(dependencies.transport),
      development: typeof __DEV__ !== 'undefined' && __DEV__,
    });
    try {
      assertBuild(runtime, runtime.publicKey);
    } catch (error) {
      runtime.supabase.auth.stopAutoRefresh();
      throw error;
    }
    globalThis.fetch = runtime.fetch;
    installed = runtime;
    return runtime;
  },
  read(): Runtime | null {
    const mode = process.env.EXPO_PUBLIC_HOSTED_STOREFRONT;
    if (!attempted && (mode === undefined || mode === '' || mode === '0'))
      return null;
    if (!installed)
      throw new Error(
        'Hosted staging runtime has not been independently verified'
      );
    assertBuild(installed, installed.publicKey);
    return installed;
  },
});
