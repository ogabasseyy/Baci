import { getLocalStorefrontStoragePrefix } from './local-storefront-storage-prefix';

export function isStorefrontTelemetryExcluded(
  hostedMode: unknown = process.env.EXPO_PUBLIC_HOSTED_STOREFRONT
): boolean {
  if (hostedMode !== undefined && hostedMode !== '' && hostedMode !== '0')
    return true;
  return Boolean(getLocalStorefrontStoragePrefix());
}
