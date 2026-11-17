import { getRootDomain } from '@/env';
import { getConfiguredAgenticMerchantSlug } from '@/lib/agentic/agentic-merchant-slug';
import { isVercelPreview } from '@/lib/proxy/host';
import { getRequestHost } from '@/lib/storefront-host';
import { resolveStorefrontMerchantFromRequest } from '@/lib/storefront-merchant';

const NOT_FOUND_ERROR = 'Device check is only available on storefront hosts';

export type DeviceCheckStorefront =
  | { ok: true; merchantId: string }
  | { ok: false; error: string; status: 400 | 404 | 500 };

/**
 * Resolves the published store a device check belongs to. The request host
 * decides whenever it names a store (subdomain or custom domain); the
 * client-supplied slug is only a fallback for platform hosts, where stores
 * are reached by path. Vercel preview deployments are platform hosts too, so
 * their host is not treated as a store's custom domain.
 *
 * The native app sends no slug, so on a platform host it falls back to the
 * server-configured store, the identity the app's chat uses. Browsers always
 * send an Origin header on a POST; a browser request without a slug gets no
 * such fallback, so a page whose store context is missing fails instead of
 * being priced against another store's catalogue.
 */
export async function resolveDeviceCheckStorefront(
  request: Request,
  merchantSlug: string | null
): Promise<DeviceCheckStorefront> {
  const rootDomain = getRootDomain() || 'usebaci.com';
  const resolutionRequest = isVercelPreview(getRequestHost(request))
    ? new Request(`https://${rootDomain}/`)
    : request;

  const nativeAppFallback = request.headers.get('origin')
    ? undefined
    : getConfiguredAgenticMerchantSlug();

  const resolution = await resolveStorefrontMerchantFromRequest({
    fallbackIdentifier: merchantSlug ?? nativeAppFallback,
    lookupError: 'Failed to validate storefront host',
    notFoundError: NOT_FOUND_ERROR,
    request: resolutionRequest,
    rootDomain,
  });

  if (!resolution.success) {
    return { ok: false, error: resolution.error, status: resolution.status };
  }
  if (!resolution.merchant.is_published) {
    return { ok: false, error: NOT_FOUND_ERROR, status: 404 };
  }
  return { ok: true, merchantId: String(resolution.merchant.id) };
}
