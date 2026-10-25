import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { CartPageWrapper } from '@/components/storefront/ogabassey/pages/cart-page-wrapper';
import {
  getCachedMerchant,
  getCachedMerchantByDomain,
} from '@/lib/cached-data';
import { createClient } from '@/lib/supabase/server';
import { isDomainIdentifier } from '@/lib/validation';

export async function CartContent({
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

  const merchantId = merchant.id;
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
      vatEnabled={vatEnabled}
      vatRate={vatRate}
    />
  );
}
