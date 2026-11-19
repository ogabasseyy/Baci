import { buildMerchantAnalyticsSettings } from '@/components/analytics/analytics-merchant-settings';
import type {
  StorefrontShellSnapshot,
  StorefrontShellSnapshotBase,
} from '@/hooks/merchant/types';
import {
  type CategoryNavItem,
  getStorefrontNavigationCategories,
} from '@/lib/cached-categories';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import { toTemplateMerchantData } from '@/lib/merchant-template-data';
import { isDomainIdentifier } from '@/lib/validation';

type RoutingMode = 'domain' | 'path';

function resolveRoutingMode(slug: string): RoutingMode {
  return isDomainIdentifier(slug) ? 'domain' : 'path';
}

export async function getStorefrontShellSnapshotBase(
  slug: string
): Promise<StorefrontShellSnapshotBase | null> {
  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    return null;
  }

  const routingMode = resolveRoutingMode(slug);
  const merchantData = toTemplateMerchantData(merchant);

  return {
    chatgptPixelId:
      buildMerchantAnalyticsSettings(merchant)?.chatgpt_pixel_id ?? null,
    merchant: merchantData,
    routingMode,
    basePath: routingMode === 'domain' ? '' : `/${merchant.slug}`,
  };
}

/**
 * A navigation-categories read started before its merchant resolved, keyed
 * by the merchant id the caller assumed. The snapshot adopts it only when
 * the resolved merchant id matches; otherwise it fetches by the real id, so
 * a stale assumption can cost overlap but never correctness.
 */
export interface EagerShellCategories {
  merchantId: string;
  categories: Promise<CategoryNavItem[]>;
}

export async function getStorefrontShellSnapshot(
  slugOrBaseSnapshot: string | StorefrontShellSnapshotBase,
  eagerCategories?: EagerShellCategories | null
): Promise<StorefrontShellSnapshot | null> {
  const shellSnapshotBase =
    typeof slugOrBaseSnapshot === 'string'
      ? await getStorefrontShellSnapshotBase(slugOrBaseSnapshot)
      : slugOrBaseSnapshot;

  if (!shellSnapshotBase) {
    return null;
  }

  const navigationCategories =
    eagerCategories &&
    eagerCategories.merchantId === shellSnapshotBase.merchant.id
      ? await eagerCategories.categories
      : await getStorefrontNavigationCategories(shellSnapshotBase.merchant.id);

  return {
    ...shellSnapshotBase,
    navigationCategories,
  };
}
