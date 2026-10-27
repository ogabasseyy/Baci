import type { SupabaseClient } from '@supabase/supabase-js';
import { redactMerchantIntegrationContext } from '@/lib/merchant-feature-settings-redaction';
import { dashboardMerchantContextSchema } from '@/schemas/dashboard-merchant-context';
import { defaultStaffAccess } from './constants';
import type { MerchantData, StaffAccess } from './types';

export type DashboardMerchantContext = {
  merchant: MerchantData | null;
  primaryDomain: string | null;
  staffAccess: StaffAccess;
};

export async function fetchDashboardMerchantContext(
  supabase: SupabaseClient
): Promise<DashboardMerchantContext> {
  const { data, error } = await supabase.rpc('get_user_merchant_context');

  if (error) {
    throw error;
  }

  if (!data) {
    return {
      merchant: null,
      primaryDomain: null,
      staffAccess: { ...defaultStaffAccess },
    };
  }

  const parsed = dashboardMerchantContextSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('Invalid dashboard merchant context returned by database');
  }

  return {
    merchant: redactMerchantIntegrationContext(
      parsed.data.merchant
    ) as MerchantData | null,
    primaryDomain: parsed.data.primaryDomain?.domain ?? null,
    staffAccess: parsed.data.staffAccess as StaffAccess,
  };
}
