import { headers } from 'next/headers';
import { getRootDomain } from '@/env';
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

function shouldFallbackToPathRouting(error: unknown): boolean {
  const digest =
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest?: unknown }).digest === 'string'
      ? (error as { digest: string }).digest
      : null;

  return (
    digest === 'HANGING_PROMISE_REJECTION' ||
    digest === 'NEXT_PRERENDER_INTERRUPTED'
  );
}

function normalizeHostHeader(rawHost: string | null): string {
  return (
    rawHost?.split(',')[0]?.trim().replace(/:\d+$/, '').toLowerCase() ?? ''
  );
}

async function resolveRoutingMode(slug: string): Promise<RoutingMode> {
  if (isDomainIdentifier(slug)) {
    return 'domain';
  }

  try {
    const headersList = await headers();
    const requestHost = normalizeHostHeader(
      headersList.get('host') || headersList.get('x-forwarded-host')
    );
    const rootDomain = normalizeHostHeader(getRootDomain() || 'usebaci.com');
    const slugSubdomainHost = `${slug.toLowerCase()}.${rootDomain}`;
    const hostMatchesSlugSubdomain = requestHost === slugSubdomainHost;

    return headersList.has('x-merchant-slug') ||
      headersList.has('x-custom-domain') ||
      hostMatchesSlugSubdomain
      ? 'domain'
      : 'path';
  } catch (error) {
    if (shouldFallbackToPathRouting(error)) {
      return 'path';
    }

    throw error;
  }
}

export async function getStorefrontShellSnapshotBase(
  slug: string
): Promise<StorefrontShellSnapshotBase | null> {
  const merchant = await getRequestScopedMerchant(slug);

  if (!merchant) {
    return null;
  }

  const routingMode = await resolveRoutingMode(slug);
  const merchantData = toTemplateMerchantData(merchant);

  return {
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
