import 'server-only';
import { headers } from 'next/headers';
import { logger } from '@/lib/logger';
import { resolveStorefrontRouteIdentifiers } from '@/lib/storefront-host';
import { resolveStorefrontMerchantFromRequest } from '@/lib/storefront-merchant';
import { hasStorefrontPriceNegotiation } from '@/lib/storefront-price-negotiation';
import { getConfiguredAgenticMerchantSlug } from './agentic-merchant-slug';

export interface AgenticChatTenant {
  agenticCheckoutEnabled: boolean;
  businessName: string;
  currencyCode: string;
  merchantId: string;
  merchantSlug: string;
  priceNegotiationEnabled: boolean;
}

function normalizeMerchantHint(value: string | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

async function createRequestFromHeaders(): Promise<Request> {
  const requestHeaders = await headers();
  const host = requestHeaders.get('host');
  const merchantHint = requestHeaders.get('x-baci-storefront-slug');

  return new Request('https://chat.invalid/api/chat', {
    headers: {
      ...(host ? { host } : {}),
      ...(merchantHint ? { 'x-baci-storefront-slug': merchantHint } : {}),
    },
  });
}

function getRootDomain(): string {
  return process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim() || 'usebaci.com';
}

export function getAgenticChatTenantResolutionInput({
  configuredSlug,
  request,
}: {
  configuredSlug: string;
  request: Request;
}): { fallbackIdentifier?: string; rootDomain: string } | null {
  // The raw Host header is the authority boundary. Request.url is not a safe
  // substitute here because it can be synthesized by an upstream runtime.
  if (!request.headers.get('host')) return null;

  const rootDomain = getRootDomain();
  const hostIdentifiers = resolveStorefrontRouteIdentifiers({
    request,
    rootDomain,
  });

  // Only the central platform and localhost paths need configuration fallback
  // (notably the native client). Any tenant-looking host must resolve itself.
  return hostIdentifiers.length === 0
    ? { fallbackIdentifier: configuredSlug, rootDomain }
    : { rootDomain };
}

/**
 * Resolves the one configured chat tenant through the public storefront
 * resolver. A storefront host may corroborate the configured tenant, but it
 * never selects an arbitrary merchant for payment or order operations.
 *
 * Platform-hosted mobile clients have no storefront host. For those requests,
 * the server-owned configured slug is the fallback identity. A widget may send
 * `x-baci-storefront-slug` as a mismatch assertion only; it is never used to
 * choose the tenant.
 */
export async function resolveAgenticChatTenant(
  request?: Request
): Promise<AgenticChatTenant | null> {
  const configuredSlug = getConfiguredAgenticMerchantSlug();
  if (!configuredSlug) return null;

  try {
    const requestForResolution = request ?? (await createRequestFromHeaders());
    const resolutionInput = getAgenticChatTenantResolutionInput({
      configuredSlug,
      request: requestForResolution,
    });
    if (!resolutionInput) return null;
    const hint = normalizeMerchantHint(
      requestForResolution.headers.get('x-baci-storefront-slug')
    );
    const resolved = await resolveStorefrontMerchantFromRequest({
      lookupError: 'Chat storefront lookup failed',
      notFoundError: 'Chat storefront not found',
      request: requestForResolution,
      ...resolutionInput,
    });

    if (
      !resolved.success ||
      !resolved.merchant.is_published ||
      resolved.merchant.slug !== configuredSlug ||
      (hint !== undefined && hint !== resolved.merchant.slug)
    ) {
      return null;
    }

    return {
      agenticCheckoutEnabled:
        resolved.merchant.feature_settings?.agentic_checkout_enabled !== false,
      businessName: resolved.merchant.business_name,
      currencyCode: resolved.merchant.payout_currency,
      merchantId: resolved.merchant.id,
      merchantSlug: resolved.merchant.slug,
      priceNegotiationEnabled: hasStorefrontPriceNegotiation(resolved.merchant),
    };
  } catch (error) {
    logger.warn({
      error,
      message: 'Agentic chat tenant resolution failed',
    });
    return null;
  }
}
