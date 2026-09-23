import { isRepairsCatalogEnabled } from '@/lib/repairs/repairs-feature';
import { resolveWalletTopUpMerchant } from '@/lib/resolve-wallet-top-up-merchant';
import type { createClient } from '@/lib/supabase/server';

type RepairPickupPaymentSupabase = Awaited<ReturnType<typeof createClient>>;

export type RepairPickupPaymentMerchant = {
  id: string;
  slug: string;
};

/**
 * Resolves a published storefront merchant with repairs catalogue enabled.
 * Uses business_type from merchants plus the public SECURITY DEFINER catalog
 * gate (anon cannot read merchant_feature_settings) and the pure TS predicate.
 */
export async function resolveRepairPickupPaymentMerchant(options: {
  merchantId: string;
  merchantSlug: string;
  supabase: RepairPickupPaymentSupabase;
}): Promise<RepairPickupPaymentMerchant | null> {
  const merchant = await resolveWalletTopUpMerchant<{
    id: string;
    slug: string | null;
    is_published: boolean | null;
    business_type: string | null;
  }>(
    options.supabase,
    {
      merchantId: options.merchantId,
      merchantSlug: options.merchantSlug,
    },
    'id, slug, is_published, business_type'
  );
  if (
    !merchant?.is_published ||
    merchant.id !== options.merchantId ||
    !merchant.slug
  ) {
    return null;
  }

  const { data: catalogPubliclyEnabled, error: catalogError } =
    await options.supabase.rpc('repairs_catalog_publicly_enabled', {
      p_merchant_id: merchant.id,
    });
  if (
    catalogError ||
    !isRepairsCatalogEnabled({
      businessType: merchant.business_type,
      repairsCatalogEnabled: catalogPubliclyEnabled === true,
    })
  ) {
    return null;
  }

  return { id: merchant.id, slug: merchant.slug };
}
