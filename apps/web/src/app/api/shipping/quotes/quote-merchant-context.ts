import type { SupabaseClient } from '@supabase/supabase-js';
import { hasPermission } from '@/lib/api-auth';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { buildMerchantSenderInfo } from '@/lib/shipping/merchant-sender-location';
import type { ShippingAddress } from '@/lib/shipping/types';
import { createClient as createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveBodyOnlyMerchantSender } from './resolve-body-only-merchant-sender';
import { resolveMerchantDetails } from './resolve-quote-merchant-details';
import { resolveQuoteMerchantLookupClient } from './resolve-quote-merchant-lookup-client';

type QuoteInput = {
  merchantId?: string;
  sender?: ShippingAddress;
  shipmentType: 'domestic' | 'international';
};

export type QuoteMerchantContextResult =
  | {
      ok: true;
      merchantId?: string;
      senderInfo?: ShippingAddress;
      /** Resolved merchant ISO country used to gate Nigeria-only carriers. */
      merchantCountry?: string | null;
      /**
       * Merchant's payout currency, when a merchant was resolved. The route
       * resolves the canonical merchant currency (payout_currency -> country
       * -> NGN) from this and blocks the NGN-denominated carrier quotes for
       * merchants whose canonical currency is not NGN.
       */
      merchantPayoutCurrency?: string | null;
    }
  | { error: string; ok: false; status: number };

type HeaderReader = {
  headers: {
    get(name: string): string | null;
  };
};

function normalizeHeader(value: string | null): string | undefined {
  return value?.trim().toLowerCase() || undefined;
}

function normalizeHost(value: string | null): string {
  return (value ?? '').split(':')[0]?.trim().toLowerCase() ?? '';
}

function isTrustedStorefrontHeader(request: HeaderReader): boolean {
  const host = normalizeHost(request.headers.get('host'));
  const slug = normalizeHeader(request.headers.get('x-merchant-slug'));
  const domain = normalizeHeader(request.headers.get('x-merchant-domain'));
  const rootDomain = (
    process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'usebaci.com'
  ).toLowerCase();

  if (domain && (host === domain || host === `www.${domain}`)) {
    return true;
  }

  if (!slug) return false;

  return (
    host === `${slug}.${rootDomain}` ||
    host === `${slug}.localhost` ||
    host.startsWith(`${slug}.localhost:`)
  );
}

async function resolveAuthenticatedMerchantId(
  request: HeaderReader,
  supabase: SupabaseClient,
  requestedMerchantId?: string
): Promise<string | undefined | QuoteMerchantContextResult> {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : undefined;

  const authClient = token ? supabase : await createServerSupabaseClient();
  const {
    data: { user },
  } = token
    ? await authClient.auth.getUser(token)
    : await authClient.auth.getUser();

  if (!user) return undefined;

  const merchantContext = await getMerchantForApiRequest(supabase, user.id, {
    requestedMerchantId,
  });
  if (!merchantContext) return undefined;

  const access = toUserAccess(merchantContext);
  if (!hasPermission(access, 'orders', 'fulfill')) {
    return { error: 'Forbidden', ok: false, status: 403 };
  }

  return merchantContext.merchantId;
}

async function resolveStorefrontMerchantId(
  request: HeaderReader,
  supabase: SupabaseClient
): Promise<string | undefined | QuoteMerchantContextResult> {
  if (!isTrustedStorefrontHeader(request)) return undefined;

  const slug = normalizeHeader(request.headers.get('x-merchant-slug'));
  if (slug) {
    const { data, error } = await supabase
      .from('merchants')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (error) {
      console.error('Error resolving storefront merchant slug:', error);
      return {
        error: 'Failed to resolve storefront merchant',
        ok: false,
        status: 500,
      };
    }

    const merchant = data as { id?: string } | null;
    if (merchant?.id) return merchant.id;

    // Retired-slug fallback: the store was renamed via the "Change store URL"
    // flow, so `slug` is now a retired alias. A stale client still on the old
    // `<slug>.usebaci.com` host (e.g. a POST /api/shipping/quotes mid-checkout)
    // must still resolve to the CURRENT merchant. host still equals the presented
    // slug, so isTrustedStorefrontHeader held above; and because a live merchant
    // is looked up FIRST, a slug reclaimed by a new store wins over the alias.
    const { data: aliasData, error: aliasError } = await supabase
      .from('merchant_slug_aliases')
      .select('merchant_id')
      .eq('old_slug', slug)
      .maybeSingle();
    if (aliasError) {
      console.error('Error resolving storefront merchant alias:', aliasError);
      return {
        error: 'Failed to resolve storefront merchant',
        ok: false,
        status: 500,
      };
    }
    const aliasRow = aliasData as { merchant_id?: string } | null;
    if (aliasRow?.merchant_id) return aliasRow.merchant_id;
  }

  const domain = normalizeHeader(request.headers.get('x-merchant-domain'));
  if (!domain) return undefined;

  const { data, error } = await supabase
    .from('domains')
    .select('merchant_id')
    .eq('domain', domain)
    .eq('status', 'active')
    .maybeSingle();
  if (error) {
    console.error('Error resolving storefront merchant domain:', error);
    return {
      error: 'Failed to resolve storefront merchant',
      ok: false,
      status: 500,
    };
  }

  const domainRow = data as { merchant_id?: string } | null;
  return domainRow?.merchant_id;
}

export async function resolveQuoteMerchantContext({
  data,
  request,
  supabase,
}: {
  data: QuoteInput;
  request: HeaderReader;
  supabase: SupabaseClient;
}): Promise<QuoteMerchantContextResult> {
  const authenticatedMerchantId = await resolveAuthenticatedMerchantId(
    request,
    supabase,
    data.merchantId
  );

  const storefrontMerchantId = await resolveStorefrontMerchantId(
    request,
    supabase
  );
  if (storefrontMerchantId && typeof storefrontMerchantId === 'object') {
    return storefrontMerchantId;
  }
  const permittedAuthenticatedMerchantId =
    typeof authenticatedMerchantId === 'string'
      ? authenticatedMerchantId
      : undefined;

  if (
    authenticatedMerchantId &&
    typeof authenticatedMerchantId === 'object' &&
    !storefrontMerchantId
  ) {
    return authenticatedMerchantId;
  }

  const merchantId =
    storefrontMerchantId ?? permittedAuthenticatedMerchantId ?? data.merchantId;
  const trustedSenderMerchantId =
    storefrontMerchantId ?? permittedAuthenticatedMerchantId;
  // Older mobile clients omit x-baci-client. This public projection is safe
  // without that advisory header; the body ID never grants private-table access.
  const bodyOnlyMerchantId = !trustedSenderMerchantId ? merchantId : undefined;
  let senderInfo =
    data.shipmentType === 'international' ? undefined : data.sender;
  let merchantCountry: string | null | undefined;
  let merchantPayoutCurrency: string | null | undefined;

  if (trustedSenderMerchantId) {
    const merchantLookupClient = await resolveQuoteMerchantLookupClient(
      request,
      supabase
    );
    const details = await resolveMerchantDetails(
      merchantLookupClient,
      trustedSenderMerchantId
    );
    if (details && 'ok' in details) return details;
    if (details) {
      merchantCountry = details.country;
      merchantPayoutCurrency = details.payout_currency;
      const merchantSender = buildMerchantSenderInfo({
        businessAddress: details.business_address,
        businessName: details.business_name,
        phone: details.phone,
        registeredAddress: null,
        stateCode: details.state_code ?? null,
      });
      senderInfo = merchantSender ?? undefined;
    }
  }

  if (bodyOnlyMerchantId) {
    const publicSenderResult = await resolveBodyOnlyMerchantSender(
      request,
      supabase,
      bodyOnlyMerchantId
    );
    if (!publicSenderResult.ok) {
      console.error('Error resolving public storefront shipping sender:', {
        merchantId: bodyOnlyMerchantId,
        error: publicSenderResult.error,
      });
      return {
        error: 'Failed to resolve merchant sender',
        ok: false,
        status: 500,
      };
    }
    if (!publicSenderResult.sender) {
      return {
        error:
          data.shipmentType === 'international'
            ? 'Sender is required for international quotes'
            : 'Merchant shipping origin is not configured',
        ok: false,
        status: 400,
      };
    }
    senderInfo = publicSenderResult.sender;
    merchantCountry = publicSenderResult.country;
  }

  return {
    ok: true,
    merchantId,
    senderInfo,
    merchantCountry,
    merchantPayoutCurrency,
  };
}
