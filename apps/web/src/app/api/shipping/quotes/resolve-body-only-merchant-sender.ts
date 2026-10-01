import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type PublicMerchantSenderResult,
  resolvePublicMerchantSender,
} from './resolve-public-merchant-sender';
import { resolveQuoteMerchantLookupClient } from './resolve-quote-merchant-lookup-client';

type HeaderReader = {
  headers: {
    get(name: string): string | null;
  };
};

/**
 * Resolves a storefront's body-only merchant origin using the
 * anonymous-safe projection, without granting the body merchant ID access to
 * the private merchants table.
 */
export async function resolveBodyOnlyMerchantSender(
  request: HeaderReader,
  supabase: SupabaseClient,
  merchantId: string
): Promise<PublicMerchantSenderResult> {
  const merchantLookupClient = await resolveQuoteMerchantLookupClient(
    request,
    supabase
  );
  return resolvePublicMerchantSender(merchantLookupClient, merchantId);
}
