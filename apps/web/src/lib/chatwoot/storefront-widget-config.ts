import 'server-only';

import {
  ChatwootCommerceContextError,
  getChatwootTenantBinding,
  getFixedChatwootPlatformOrigin,
} from './commerce-context';

export type StorefrontChatwootWidgetConfig = {
  platformOrigin: string;
  storefrontOrigin: string;
  websiteToken: string;
};

/** Resolve only an explicitly enabled tenant binding; no client input selects a merchant. */
export function getStorefrontChatwootWidgetConfig(
  merchantId: string
): StorefrontChatwootWidgetConfig | null {
  if (
    process.env.EKAETTE_CHATWOOT_WIDGET_ENABLED !== 'true' ||
    process.env.EKAETTE_CHATWOOT_CONTEXT_ENABLED !== 'true'
  ) {
    return null;
  }

  try {
    const binding = getChatwootTenantBinding(merchantId);
    return {
      platformOrigin: getFixedChatwootPlatformOrigin(),
      storefrontOrigin: binding.origin,
      websiteToken: binding.websiteToken,
    };
  } catch (error) {
    if (error instanceof ChatwootCommerceContextError) return null;
    console.warn('Unexpected storefront Chatwoot widget config failure');
    return null;
  }
}
