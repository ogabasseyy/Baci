import { defaultStaffAccess } from './constants';
import type { MerchantData, StaffAccess } from './types';

export interface DashboardMerchantResult {
  merchant: MerchantData | null;
  staffAccess: StaffAccess;
}

/**
 * Client-side loader for the signed-in user's dashboard merchant context.
 *
 * Reads through the `/api/merchant/me` server boundary. The implicit dashboard
 * context can include sensitive own-merchant columns, so it is resolved by the
 * caller-bound server RPC. Explicit selection returns only a bounded profile
 * after the server verifies owner/staff access to that exact merchant.
 */
export async function fetchDashboardMerchantViaApi(options?: {
  merchantId?: string;
  signal?: AbortSignal;
}): Promise<DashboardMerchantResult> {
  const init: RequestInit = { credentials: 'same-origin' };
  if (options?.merchantId) {
    init.headers = { 'x-baci-merchant-id': options.merchantId };
  }
  if (options?.signal) init.signal = options.signal;

  const response = await fetch('/api/merchant/me', init);

  // A missing/expired session is not an error for the provider — it simply
  // means there is no dashboard merchant to show.
  if (response.status === 401) {
    return { merchant: null, staffAccess: { ...defaultStaffAccess } };
  }

  if (!response.ok) {
    throw new Error(`Failed to load merchant dashboard (${response.status})`);
  }

  return (await response.json()) as DashboardMerchantResult;
}
