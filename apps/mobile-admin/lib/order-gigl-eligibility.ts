interface GiglAdminShippingEligibilityInput {
  country?: string | null;
  payoutCurrency?: string | null;
  settingsReady: boolean;
  shippingProviders?: readonly string[] | null;
}

const DEFAULT_SHIPPING_PROVIDERS = ['gigl', 'topship'] as const;

export function isGiglAdminShippingEligible({
  country,
  payoutCurrency,
  settingsReady,
  shippingProviders,
}: GiglAdminShippingEligibilityInput): boolean {
  if (!settingsReady) return false;

  // Null/undefined providers inherit the storefront/admin default. Explicit
  // empty arrays remain disabled.
  const providers =
    shippingProviders == null ? DEFAULT_SHIPPING_PROVIDERS : shippingProviders;

  return (
    (country?.trim().toUpperCase() || 'NG') === 'NG' &&
    (payoutCurrency?.trim().toUpperCase() || 'NGN') === 'NGN' &&
    providers.some((provider) => provider.trim().toLowerCase() === 'gigl')
  );
}
