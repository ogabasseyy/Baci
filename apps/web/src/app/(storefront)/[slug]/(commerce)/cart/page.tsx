import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CommerceRouteLoading } from '@/app/(storefront)/[slug]/storefront-loading-ui';
import { CartPageWrapper } from '@/components/storefront/ogabassey/pages/cart-page-wrapper';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { createClient } from '@/lib/supabase/server';
import { isDomainIdentifier } from '@/lib/validation';

export const metadata: Metadata = {
  title: 'Cart',
  description: 'Review your private cart before checkout.',
  robots: { index: false, follow: false },
};

export default function CartPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  return (
    <Suspense fallback={<CommerceRouteLoading />}>
      <ResolvedCartPage params={params} />
    </Suspense>
  );
}

export async function ResolvedCartPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const merchant = isDomainIdentifier(slug)
    ? await getCachedMerchantByDomain(slug)
    : await getCachedMerchant(slug);

  if (!merchant) {
    notFound();
  }

  // Public snapshot already carries these merchant-scoped settings. Avoid a
  // second session-bound round trip on every cart navigation. Older snapshots
  // keep the streamed live-read fallback below; checkout prices on the server.
  if (
    typeof merchant.vat_registration_status === 'string' &&
    typeof merchant.vat_rate === 'number' &&
    Number.isFinite(merchant.vat_rate)
  ) {
    return (
      <CartPageWrapper
        merchantId={merchant.id}
        merchantSlug={merchant.slug}
        vatEnabled={merchant.vat_registration_status === 'registered'}
        vatRate={merchant.vat_rate}
      />
    );
  }

  return (
    <Suspense fallback={<CommerceRouteLoading />}>
      <CartContent merchantId={merchant.id} merchantSlug={merchant.slug} />
    </Suspense>
  );
}

async function CartContent({
  merchantId,
  merchantSlug,
}: {
  merchantId: string;
  merchantSlug: string;
}) {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: vatSettings, error } = await supabase
    .from('merchants')
    .select('vat_registration_status, vat_rate')
    .eq('id', merchantId)
    .single();

  if (error) {
    console.error('Failed to fetch VAT settings:', {
      merchantId,
      error: error.message,
    });
  }

  const vatEnabled = vatSettings?.vat_registration_status === 'registered';
  const vatRate = vatSettings?.vat_rate ?? 7.5;

  return (
    <CartPageWrapper
      merchantId={merchantId}
      merchantSlug={merchantSlug}
      vatEnabled={vatEnabled}
      vatRate={vatRate}
    />
  );
}
