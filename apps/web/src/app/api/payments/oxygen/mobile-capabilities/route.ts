import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkOxygenMobileCapabilitiesRateLimit } from '@/lib/oxygen-mobile-capabilities-rate-limit';
import { readOxygenMobileCapabilities } from '@/lib/payments/oxygen/mobile-capabilities';
import {
  extractLocalhostSubdomain,
  extractSubdomain,
  getSlugForOriginCustomDomain,
  isLocalhost,
  isPlatformHost,
  RESERVED_SUBDOMAINS,
  ROOT_DOMAIN,
} from '@/lib/proxy/host';
import { stripPort } from '@/lib/storefront-host';
import { oxygenMobileCapabilitiesQuerySchema } from '@/schemas/oxygen-mobile-capabilities';

const privateHeaders = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization, Cookie',
};
function failure(status: number) {
  return NextResponse.json(
    {
      error:
        status === 401
          ? 'Unauthorized'
          : status === 400
            ? 'Invalid request'
            : status === 404
              ? 'Storefront not found'
              : status === 429
                ? 'Too many Oxygen requests. Please try again shortly.'
                : 'Oxygen capabilities unavailable',
    },
    { status, headers: privateHeaders }
  );
}

/** No provider connection or workflow claim is performed by this read. */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase) return failure(401);
  try {
    const limit = await checkOxygenMobileCapabilitiesRateLimit(auth.user.id);
    if (!limit.allowed) return failure(429);
    const params = request.nextUrl.searchParams;
    const parsed = oxygenMobileCapabilitiesQuerySchema.safeParse(
      Object.fromEntries(params)
    );
    if (!parsed.success || params.getAll('merchantSlug').length !== 1)
      return failure(400);
    const slug = parsed.data.merchantSlug;
    const authority = (
      request.headers.get('host') || request.nextUrl.host
    ).toLowerCase();
    const host = stripPort(authority);
    if (host.startsWith('[') && !/^\[::1\](?::\d{1,5})?$/.test(authority))
      return failure(404);
    // Central API hosts have no storefront identity: the RPC proves the supplied
    // slug's customer binding. Storefront hosts additionally pin their own tenant.
    if (host !== '[::1]' && !isPlatformHost(host)) {
      const subdomain = isLocalhost(host)
        ? extractLocalhostSubdomain(host)
        : extractSubdomain(host, ROOT_DOMAIN);
      const resolved = subdomain
        ? RESERVED_SUBDOMAINS.has(subdomain)
          ? null
          : subdomain
        : await getSlugForOriginCustomDomain(host);
      if (resolved !== slug) return failure(404);
    }
    const result = await readOxygenMobileCapabilities(auth.supabase, slug);
    return result.ok
      ? NextResponse.json(result.capabilities, { headers: privateHeaders })
      : failure(result.status);
  } catch {
    return failure(503);
  }
}
