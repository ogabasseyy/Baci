import { z } from 'zod';
import { STOREFRONT_AGENT_ROUTES } from '@/config/storefront-agent-routes';
import { buildStoreUrl } from '@/lib/store-url';
import type { AgenticAction } from '@/schemas/agentic-action-health';

const UCP_FETCH_TIMEOUT_MS = 5_000;
const UCP_CAPABILITIES = {
  ap2Mandate: 'dev.ucp.shopping.ap2_mandate',
  cart: 'dev.ucp.shopping.cart',
  catalogLookup: 'dev.ucp.shopping.catalog.lookup',
  catalogSearch: 'dev.ucp.shopping.catalog.search',
  checkout: 'dev.ucp.shopping.checkout',
  order: 'dev.ucp.shopping.order',
} as const;

export const UNIVERSAL_CART_CHECKS = [
  'ucp_profile_reachable',
  'ucp_cart_capability',
  'ucp_catalog_search_capability',
  'ucp_catalog_lookup_capability',
  'ucp_checkout_capability',
  'ucp_order_capability',
  'payment_handler_configured',
  'google_pay_not_misadvertised',
  'ap2_not_misadvertised',
] as const;

export type UniversalCartCheckId = (typeof UNIVERSAL_CART_CHECKS)[number];
export type UniversalCartReadinessStatus = 'fail' | 'pass' | 'warn';

export interface UniversalCartReadinessCheck {
  id: UniversalCartCheckId;
  message: string;
  status: UniversalCartReadinessStatus;
}

export interface UniversalCartReadinessResult {
  checks: UniversalCartReadinessCheck[];
  lastCheckedAt: string;
  status: UniversalCartReadinessStatus;
  url: string;
  /** Cart transfer (create/read/replace/cancel) readiness alone. */
  cartTransferReady?: boolean;
  /** Native checkout/payment/order readiness alone. */
  checkoutReady?: boolean;
}

interface UniversalCartReadinessMerchant {
  custom_domain?: string | null;
  slug: string;
}

const recordSchema = z.looseObject({});

function getRecord(value: unknown): Record<string, unknown> | null {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function getNestedRecord(
  record: Record<string, unknown> | null,
  key: string
): Record<string, unknown> | null {
  return record ? getRecord(record[key]) : null;
}

function hasCapability(
  capabilities: Record<string, unknown> | null,
  capability: string
) {
  const entries = capabilities?.[capability];
  return Array.isArray(entries) && entries.length > 0;
}

function hasPaymentHandlers(handlers: Record<string, unknown> | null) {
  if (!handlers) return false;
  return Object.values(handlers).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object' && value !== null) {
      return Object.keys(value).length > 0;
    }
    return Boolean(value);
  });
}

function isGooglePayConfigured(handlers: Record<string, unknown> | null) {
  const entries = handlers?.['com.google.pay'];
  if (!Array.isArray(entries) || entries.length === 0) return true;
  return entries.some((entry) => {
    const config = getNestedRecord(getRecord(entry), 'config');
    return config?.gateway === 'paystack';
  });
}

function buildCheck(
  id: UniversalCartCheckId,
  status: UniversalCartReadinessStatus,
  message: string
): UniversalCartReadinessCheck {
  return { id, message, status };
}

function getReadinessStatus(checks: UniversalCartReadinessCheck[]) {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warn')) return 'warn';
  return 'pass';
}

function buildReadinessResult({
  checkedAt,
  profile,
  profileIssue,
  url,
}: {
  checkedAt: string;
  profile: unknown;
  profileIssue?: string;
  url: string;
}): UniversalCartReadinessResult {
  const profileRecord = getRecord(profile);
  const ucp = getNestedRecord(profileRecord, 'ucp');
  const capabilities = getNestedRecord(ucp, 'capabilities');
  const handlers = getNestedRecord(ucp, 'payment_handlers');
  const checks: UniversalCartReadinessCheck[] = [
    buildCheck(
      'ucp_profile_reachable',
      profileIssue ? 'fail' : 'pass',
      profileIssue ?? 'UCP profile is reachable.'
    ),
    buildCapabilityCheck(
      'ucp_cart_capability',
      capabilities,
      UCP_CAPABILITIES.cart,
      'UCP cart capability is advertised.'
    ),
    buildCapabilityCheck(
      'ucp_catalog_search_capability',
      capabilities,
      UCP_CAPABILITIES.catalogSearch,
      'UCP catalog search capability is advertised.'
    ),
    buildCapabilityCheck(
      'ucp_catalog_lookup_capability',
      capabilities,
      UCP_CAPABILITIES.catalogLookup,
      'UCP catalog lookup capability is advertised.'
    ),
    buildCapabilityCheck(
      'ucp_checkout_capability',
      capabilities,
      UCP_CAPABILITIES.checkout,
      'UCP checkout capability is advertised.'
    ),
    buildCapabilityCheck(
      'ucp_order_capability',
      capabilities,
      UCP_CAPABILITIES.order,
      'UCP order capability is advertised.'
    ),
    buildCheck(
      'payment_handler_configured',
      hasPaymentHandlers(handlers) ? 'pass' : 'fail',
      hasPaymentHandlers(handlers)
        ? 'At least one UCP payment handler is configured.'
        : 'UCP checkout requires an advertised payment handler.'
    ),
    buildCheck(
      'google_pay_not_misadvertised',
      isGooglePayConfigured(handlers) ? 'pass' : 'fail',
      isGooglePayConfigured(handlers)
        ? 'Google Pay is absent or backed by Paystack gateway config.'
        : 'Google Pay is advertised without Paystack gateway config.'
    ),
    buildCheck(
      'ap2_not_misadvertised',
      hasCapability(capabilities, UCP_CAPABILITIES.ap2Mandate)
        ? 'fail'
        : 'pass',
      hasCapability(capabilities, UCP_CAPABILITIES.ap2Mandate)
        ? 'AP2 mandate support is advertised without a verifier.'
        : 'AP2 mandate support is not misadvertised.'
    ),
  ];

  const checkById = new Map(checks.map((check) => [check.id, check.status]));
  return {
    cartTransferReady: checkById.get('ucp_cart_capability') === 'pass',
    checkoutReady:
      checkById.get('ucp_checkout_capability') === 'pass' &&
      checkById.get('payment_handler_configured') === 'pass',
    checks,
    lastCheckedAt: checkedAt,
    status: getReadinessStatus(checks),
    url,
  };
}

function buildCapabilityCheck(
  id: UniversalCartCheckId,
  capabilities: Record<string, unknown> | null,
  capability: string,
  passMessage: string
) {
  const advertised = hasCapability(capabilities, capability);
  return buildCheck(
    id,
    advertised ? 'pass' : 'fail',
    advertised ? passMessage : `${capability} is missing from UCP capabilities.`
  );
}

export async function checkAgentCommerceUniversalCartReadiness(
  merchant: UniversalCartReadinessMerchant,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date()
): Promise<UniversalCartReadinessResult> {
  const baseUrl = buildStoreUrl({
    custom_domain: merchant.custom_domain ?? undefined,
    slug: merchant.slug,
  });
  const url = new URL(STOREFRONT_AGENT_ROUTES.ucpProfile, baseUrl).toString();
  const checkedAt = now().toISOString();

  try {
    const response = await fetcher(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(UCP_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return buildReadinessResult({
        checkedAt,
        profile: null,
        profileIssue: `UCP profile returned HTTP ${response.status}.`,
        url,
      });
    }
    return buildReadinessResult({
      checkedAt,
      profile: await response.json(),
      url,
    });
  } catch (_error) {
    return buildReadinessResult({
      checkedAt,
      profile: null,
      profileIssue: 'UCP profile could not be fetched.',
      url,
    });
  }
}

export function buildAgentCommerceUniversalCartHealthActions(
  readiness: UniversalCartReadinessResult
): AgenticAction[] {
  if (readiness.status === 'pass') return [];
  const failingChecks = readiness.checks.filter(
    (check) => check.status === 'fail'
  );
  const warningChecks = readiness.checks.filter(
    (check) => check.status === 'warn'
  );
  const severity = failingChecks.length > 0 ? 'attention' : 'monitor';
  return [
    {
      code:
        severity === 'attention'
          ? 'AGENT_COMMERCE_UNIVERSAL_CART_NOT_READY'
          : 'AGENT_COMMERCE_UNIVERSAL_CART_MONITOR',
      count: Math.max(1, failingChecks.length + warningChecks.length),
      message: 'Universal Cart readiness checks need review.',
      next_step:
        'Open /.well-known/ucp and verify cart, catalog, checkout, order, and payment handler advertising.',
      severity,
    },
  ];
}

export function getAgentCommerceUniversalCartStatusReason(
  readiness: UniversalCartReadinessResult,
  fallbackReason: string
) {
  if (readiness.status === 'pass') return fallbackReason;
  if (readiness.status === 'fail') {
    return 'agent_commerce_universal_cart_not_ready';
  }
  return fallbackReason === 'agentic_action_health_monitor'
    ? 'agent_commerce_universal_cart_monitor'
    : fallbackReason;
}
