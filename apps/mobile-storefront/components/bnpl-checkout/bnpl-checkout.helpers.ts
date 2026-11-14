import { BNPLParamsSchema } from '@/components/bnpl-checkout/bnpl-params.schema';
import {
  type BNPLRouteParams,
  buildKlumpAuthorizationUrl,
} from '@/lib/bnpl-url';

export const BNPL_LOAD_TIMEOUT_MS = 45_000;
export const BNPL_LOAD_TIMEOUT_MESSAGE =
  'Payment page is taking longer than expected. Check your connection and try again.';
export const BNPL_UNTRUSTED_POPUP_MESSAGE =
  'Payment provider opened an untrusted checkout window.';

export {
  areBNPLCheckoutUrlsEquivalent,
  BNPL_DOCUMENT_ACCEPT_HEADER,
  buildBNPLDocumentSource,
  isBNPLCheckoutExitUrl,
  resolveBNPLDocumentNavigation,
  sanitizeBNPLDocumentUrl,
} from './bnpl-checkout-navigation';

export function parseBNPLParams(params: BNPLRouteParams) {
  const result = BNPLParamsSchema.safeParse(params);
  if (!result.success) {
    return {
      data: null,
      error: result.error.issues[0]?.message || 'Invalid parameters',
      isValid: false,
    };
  }
  return { data: result.data, error: null, isValid: true };
}

export function getBNPLGatewayName(gateway?: string) {
  return gateway === 'credpal'
    ? 'CredPal'
    : gateway === 'credit_direct'
      ? 'Credit Direct'
      : 'Klump';
}

export function extractReferenceFromUrl(url: string) {
  try {
    const urlParams = new URL(url);
    return urlParams.searchParams.get('reference');
  } catch {
    return null;
  }
}

export function extractErrorFromUrl(url: string) {
  try {
    const urlParams = new URL(url);
    return urlParams.searchParams.get('error');
  } catch {
    return null;
  }
}

export function getBNPLDebugUrlDetails(targetUrl?: string) {
  const rawUrl = targetUrl || '';
  if (!rawUrl) {
    return {
      parsed: false,
      rawUrl,
      reason: 'empty',
    };
  }

  try {
    const parsedUrl = new URL(rawUrl);
    const searchKeys = Array.from(new Set(parsedUrl.searchParams.keys()));

    return {
      hasHash: parsedUrl.hash.length > 0,
      hasSearch: parsedUrl.search.length > 0,
      hostname: parsedUrl.hostname,
      origin: parsedUrl.origin,
      parsed: true,
      pathname: parsedUrl.pathname,
      protocol: parsedUrl.protocol,
      rawUrl,
      searchKeys,
    };
  } catch {
    return {
      parsed: false,
      rawUrl,
      reason: 'invalid-url',
    };
  }
}

export function buildBNPLCheckoutUrl({
  apiBaseUrl,
  params,
}: {
  apiBaseUrl: string;
  params: ReturnType<typeof parseBNPLParams>;
}) {
  if (!params.isValid || !params.data?.orderId) return '';

  const {
    amount,
    authorizationUrl,
    customerEmail,
    customerName,
    customerPhone,
    gateway,
    orderId,
    reference,
    trackingToken,
  } = params.data;
  const slug = params.data.merchantSlug || 'ogabassey';
  const baseUrl = apiBaseUrl.endsWith('/')
    ? apiBaseUrl.slice(0, -1)
    : apiBaseUrl;

  if (gateway === 'klump') {
    return buildKlumpAuthorizationUrl({
      authorizationUrl,
      baseUrl,
      customerEmail,
      customerName,
      customerPhone,
      orderId,
      reference,
      slug,
      trackingToken,
    });
  }

  const query = new URLSearchParams({
    gateway: gateway || '',
    merchant_slug: slug,
    orderId,
  });

  if (customerEmail?.trim()) query.set('email', customerEmail.trim());
  if (customerName?.trim()) query.set('customerName', customerName.trim());
  if (customerPhone?.trim()) query.set('customerPhone', customerPhone.trim());
  if (amount?.trim()) query.set('amount', amount.trim());
  if (trackingToken?.trim()) query.set('token', trackingToken.trim());

  return `${baseUrl}/${slug}/checkout/bnpl?${query.toString()}`;
}

export { BNPL_INJECTED_JAVASCRIPT } from './bnpl-checkout-injected-script';
