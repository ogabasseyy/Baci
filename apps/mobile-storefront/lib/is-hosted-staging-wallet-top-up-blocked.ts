const STAGING_API_ORIGIN = 'https://staging.ogabassey.com';
const STAGING_SUPABASE_ORIGIN = 'https://staging-auth.ogabassey.com';

export function isHostedStagingTestPaymentsEnabled(): boolean {
  return (
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT === '1' &&
    process.env.EXPO_PUBLIC_STAGING_TEST_PAYMENTS === '1' &&
    process.env.EXPO_PUBLIC_API_URL === STAGING_API_ORIGIN &&
    process.env.EXPO_PUBLIC_SUPABASE_URL === STAGING_SUPABASE_ORIGIN
  );
}

export function isHostedStagingWalletTopUpBlocked(): boolean {
  return (
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT === '1' &&
    !isHostedStagingTestPaymentsEnabled()
  );
}
