import { getRootDomain } from '@/env';
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
 */
export async function resolveDeviceCheckStorefront(
  request: Request,
  merchantSlug: string | null
): Promise<DeviceCheckStorefront> {
  const rootDomain = getRootDomain() || 'usebaci.com';
  const resolutionRequest = isVercelPreview(getRequestHost(request))
    ? new Request(`https://${rootDomain}/`)
    : request;

  const resolution = await resolveStorefrontMerchantFromRequest({
    fallbackIdentifier: merchantSlug,
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
