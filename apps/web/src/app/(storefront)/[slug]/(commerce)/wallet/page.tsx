import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { isUsdtWalletEnabled } from '@/env';

import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { isGiftCardPreviewEnabled } from '@/lib/gift-cards/preview-catalog';
import { isLocalStorefrontTest } from '@/lib/local-storefront-test';
import { getStorefrontPathPrefix } from '@/lib/storefront-path-prefix';
import {
  isDomainIdentifier,
  isValidMerchantIdentifier,
} from '@/lib/validation';
import { WalletContentSection } from './wallet-content-section';
import {
  isWalletFundingDeepLink,
  parseUsdtWalletFundingAmount,
  parseUsdtWalletFundingReference,
} from './wallet-funding-deep-link';

export const metadata: Metadata = {
  title: 'Wallet Balance',
  description: 'Check your wallet balance',
  robots: { index: false, follow: false },
};

type WalletSearchParams = Record<string, string | string[] | undefined>;

interface WalletPageProps {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<WalletSearchParams>;
}

export default function WalletPage({ params, searchParams }: WalletPageProps) {
  return (
    <Suspense fallback={<p role="status">Preparing your wallet…</p>}>
      <WalletContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function WalletContent({ params, searchParams }: WalletPageProps) {
  const [{ slug }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<WalletSearchParams>({}),
  ]);

  // Validate identifier
  if (!isValidMerchantIdentifier(slug)) {
    notFound();
  }

  // Get merchant data handling both slugs and domains
  const lookupKey = slug.toLowerCase();
  const merchant = isDomainIdentifier(slug)
    ? await getCachedMerchantByDomain(lookupKey)
    : await getCachedMerchant(lookupKey);

  if (!merchant) {
    notFound();
  }

  // Only show for Ogabassey template (merchant-specific feature)
  if (merchant.template_id !== 'ogabassey') {
    notFound();
  }

  return (
    <WalletContentSection
      giftCardsHref={
        isGiftCardPreviewEnabled(merchant.slug)
          ? `${getStorefrontPathPrefix(await headers(), merchant)}/gift-cards`
          : undefined
      }
      localSavings={
        isLocalStorefrontTest() &&
        merchant.id === '10000000-0000-4000-8000-000000000001'
          ? { merchantId: merchant.id, merchantSlug: merchant.slug }
          : undefined
      }
      initialShowFunding={isWalletFundingDeepLink(resolvedSearchParams.fund)}
      initialShowUsdtFunding={isWalletFundingDeepLink(
        resolvedSearchParams['fund-usdt']
      )}
      initialUsdtAmount={parseUsdtWalletFundingAmount(
        resolvedSearchParams.amount
      )}
      initialUsdtReference={parseUsdtWalletFundingReference(
        resolvedSearchParams.funding
      )}
      usdtWalletEnabled={isUsdtWalletEnabled()}
    />
  );
}
