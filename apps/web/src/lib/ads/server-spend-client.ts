import 'server-only';

import {
  createServiceClient,
  type ServiceRoleClient,
} from '@/lib/supabase/service';

/**
 * Owner-approved temporary Ads sync write boundary (2026-08-25).
 * Only the four authenticated, CSRF-protected Ads sync routes may call this
 * after merchant access and `integrations:manage` are verified. The client is
 * limited by callers to the two spend-replacement RPCs. Remove this exception
 * by 2026-09-16 or when a restricted Ads worker role is available.
 */
export function createAdsSpendServiceClient(): ServiceRoleClient {
  return createServiceClient('event-pipeline');
}
