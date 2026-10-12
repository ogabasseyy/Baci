import { hostedStorefrontRuntime } from './hosted-storefront-runtime';

export function isCustomerSavingsDraftRuntimeEnabled(): boolean {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return false;

  if (process.env.EXPO_PUBLIC_HOSTED_STOREFRONT !== '1')
    return process.env.EXPO_PUBLIC_LOCAL_STOREFRONT === '1';

  try {
    const runtime = hostedStorefrontRuntime.read();
    return (
      runtime !== null &&
      runtime.apiOrigin === 'https://staging.ogabassey.com' &&
      runtime.financialActivationEnabled === false &&
      runtime.telemetryEnabled === false
    );
  } catch {
    return false;
  }
}
