import { IMEI_SERVICE_TIERS, type ImeiServiceTierKey } from '@baci/shared/imei';
import type { LucideIcon } from 'lucide-react';
import { getTierIcon } from './imei-checker-tier-icons';

const currencyFormatter = new Intl.NumberFormat('en-NG', {
  currency: 'NGN',
  maximumFractionDigits: 0,
  style: 'currency',
});

export interface DisplayImeiTier {
  detail: string;
  features: readonly string[];
  icon: LucideIcon;
  id: ImeiServiceTierKey;
  name: string;
  price: number;
  priceDisplay: string;
  recommended?: boolean;
  tagline: string;
}

/**
 * Adapts one shared-catalog tier definition into a display-ready shape for
 * web. Replaces the old hardcoded 4-key SERVICE_TIERS map — works for any of
 * the full 29-key catalog, not just the legacy primary tiers.
 */
export function getDisplayTier(tierKey: ImeiServiceTierKey): DisplayImeiTier {
  const tier = IMEI_SERVICE_TIERS[tierKey];

  return {
    detail: tier.detail,
    features: tier.features,
    icon: getTierIcon(tierKey),
    id: tierKey,
    name: tierKey === 'activation' ? 'Activation check' : tier.name,
    price: tier.price,
    priceDisplay: currencyFormatter.format(tier.price),
    recommended: 'recommended' in tier ? tier.recommended : undefined,
    tagline: tier.tagline,
  };
}
