import type { ShippingProvider } from './providers/base';
import type { ShippingProviderCode } from './types';

export interface ProviderAllowlistSelection {
  providers: ShippingProvider[];
  isRestricted: boolean;
}

/** Filter registered quote providers by a merchant's explicit allowlist. */
export function selectQuoteProviders(
  availableProviders: ShippingProvider[],
  allowedProviderCodes?: readonly ShippingProviderCode[]
): ProviderAllowlistSelection {
  if (allowedProviderCodes === undefined) {
    return { providers: availableProviders, isRestricted: false };
  }

  const allowed = new Set(allowedProviderCodes);
  return {
    providers: availableProviders.filter((provider) =>
      allowed.has(provider.code)
    ),
    isRestricted: true,
  };
}

/** Return the empty-provider warning appropriate to the selection mode. */
export function getNoProviderWarning(isRestricted: boolean): string {
  return isRestricted
    ? 'No carrier shipping providers are enabled for this store'
    : 'No shipping providers are currently enabled';
}
