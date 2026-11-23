import 'server-only';

import { readOxygenHostedOrigins } from '@/lib/payments/oxygen/oxygen-hosted-origins';
import {
  ChatwootCommerceContextError,
  getChatwootTenantBinding,
  getFixedChatwootPlatformOrigin,
} from './commerce-context';

export type StorefrontChatwootWidgetConfig = {
  platformOrigin: string;
  storefrontOrigin: string;
  websiteToken: string;
  /** In-chat order placement; off unless explicitly enabled on the server. */
  checkoutEnabled: boolean;
  /** Server-resolved Oxygen hosted-payment origins for embedded recovery. */
  oxygenHostedOrigins?: readonly string[];
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
    const checkoutEnabled =
      process.env.EKAETTE_CHATWOOT_CHECKOUT_ENABLED === 'true';
    const oxygenHostedOrigins = checkoutEnabled
      ? readOxygenHostedOrigins().hosted
      : [];
    return {
      platformOrigin: getFixedChatwootPlatformOrigin(),
      storefrontOrigin: binding.origin,
      websiteToken: binding.websiteToken,
      checkoutEnabled,
      ...(oxygenHostedOrigins.length > 0 ? { oxygenHostedOrigins } : {}),
    };
  } catch (error) {
    if (error instanceof ChatwootCommerceContextError) return null;
    console.warn('Unexpected storefront Chatwoot widget config failure');
    return null;
  }
}
