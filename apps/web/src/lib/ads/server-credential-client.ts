import 'server-only';

import {
  type AdsCredentialServiceClient,
  createServiceClient,
} from '@/lib/supabase/service';

/**
 * Creates the server-only Supabase client for Ads credential RPCs.
 *
 * Callers must authenticate the request, resolve the requested merchant from
 * trusted server context, and verify `integrations:manage` before invoking
 * credential-returning or credential-mutating RPCs. The factory's dedicated
 * sentinel keeps this capability separate from event-pipeline service-role
 * authority. It prefers `SUPABASE_ADS_CREDENTIAL_KEY`; the service-role key is
 * a temporary compatibility fallback for deployments that have not provisioned
 * the dedicated secret yet.
 */
export function createAdsCredentialServiceClient(): AdsCredentialServiceClient {
  return createServiceClient('ads-credentials');
}

export type { AdsCredentialServiceClient } from '@/lib/supabase/service';
