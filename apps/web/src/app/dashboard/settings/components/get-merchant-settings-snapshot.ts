import { createClient } from '@/lib/supabase/client';

export interface MerchantSettingsSnapshot {
  business_name: string;
  country: string;
  /** merchants.phone: the business number couriers call for pickups. */
  phone: string;
  site_description: string;
  support_email: string;
  support_phone: string;
  updated_at: string;
}

export async function getMerchantSettingsSnapshot(
  merchantId: string
): Promise<MerchantSettingsSnapshot> {
  const { data, error } = await createClient()
    .from('merchants')
    .select(
      'business_name, country, phone, site_description, support_email, support_phone, updated_at'
    )
    .eq('id', merchantId)
    .single();

  if (error) throw error;
  if (!data.updated_at) {
    throw new Error('Store settings changed. Reload before saving again.');
  }

  return {
    business_name: data.business_name ?? '',
    country: data.country ?? 'NG',
    phone: data.phone ?? '',
    site_description: data.site_description ?? '',
    support_email: data.support_email ?? '',
    support_phone: data.support_phone ?? '',
    updated_at: data.updated_at,
  };
}
