export function isRestrictedSavingsSandbox(
  environment = {
    hostedMode: process.env.EXPO_PUBLIC_HOSTED_STOREFRONT,
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    authUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  }
): boolean {
  return (
    environment.hostedMode === '1' &&
    environment.apiUrl === 'https://staging.ogabassey.com' &&
    environment.authUrl === 'https://staging-auth.ogabassey.com'
  );
}
