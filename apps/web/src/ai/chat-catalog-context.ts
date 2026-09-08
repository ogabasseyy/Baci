import 'server-only';
import { headers } from 'next/headers';
import { getRootDomain } from '@/env';
import { resolveStorefrontMerchantFromRequest } from '@/lib/storefront-merchant';
import { createClient } from '@/lib/supabase/server';

/** Catalog authority comes from the request host, never tool/model arguments. */
export async function getChatCatalogContext() {
  const requestHeaders = await headers();
  const host = requestHeaders.get('host');
  if (!host) throw new Error('Storefront context unavailable');
  const result = await resolveStorefrontMerchantFromRequest({
    request: new Request('https://storefront.invalid/api/chat', {
      headers: { host },
    }),
    rootDomain: getRootDomain() || 'usebaci.com',
    notFoundError: 'Storefront context unavailable',
    lookupError: 'Storefront context unavailable',
  });
  // This endpoint still serves the OgaBassey widget, not every merchant.
  if (!result.success || result.merchant.slug !== 'ogabassey') {
    throw new Error('Storefront context unavailable');
  }
  return { merchantId: result.merchant.id, supabase: await createClient() };
}
