import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getAgenticApiKey,
  getAgenticConfirmationKeys,
  getAgenticMerchantSlug,
  getAgenticSigningKeys,
} from '@/env';
import { readAgenticRequestControls } from '@/lib/agentic/agent-request-controls';
import { hasUsableAgenticJwtSigningMaterial } from '@/lib/agentic/jwt-signing-material';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';

export interface AgenticMerchantContext {
  agent_user_agent_allowlist: string[];
  agent_user_agent_denylist: string[];
  agentic_checkout_enabled: boolean;
  business_name: string | null;
  custom_domain?: string;
  id: string;
  pay_on_delivery_enabled: boolean;
  paystack_subaccount_code: string | null;
  slug: string;
}

export function getConfiguredAgenticMerchantSlug(): string | undefined {
  return getAgenticMerchantSlug();
}

export function isAgenticCheckoutRuntimeConfigured(): boolean {
  const confirmationKeys = getAgenticConfirmationKeys();
  const signingKeys = getAgenticSigningKeys();

  return Boolean(
    getConfiguredAgenticMerchantSlug() &&
      getAgenticApiKey() &&
      hasOnlyNonBlankEntries(confirmationKeys) &&
      hasOnlyNonBlankEntries(signingKeys) &&
      hasUsableAgenticJwtSigningMaterial()
  );
}

export const AGENTIC_CHECKOUT_DISABLED_ERROR = 'Agentic checkout disabled';

export function isAgenticMerchantCheckoutEnabled(
  merchant: AgenticMerchantContext
): boolean {
  return merchant.agentic_checkout_enabled !== false;
}

function hasOnlyNonBlankEntries(values: readonly string[]): boolean {
  return values.length > 0 && values.every((value) => value.trim().length > 0);
}

interface AgenticMerchantContextRpcClient {
  rpc(
    functionName: 'resolve_agentic_merchant_context',
    args: { p_slug: string }
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * Resolves the configured merchant through the narrowly scoped
 * SECURITY DEFINER projection instead of a service-role client, so
 * user-facing cart routes never bypass RLS to read merchant config.
 */
export async function resolveAgenticMerchantContextFromRpc(
  client: AgenticMerchantContextRpcClient
): Promise<AgenticMerchantContext | null> {
  const merchantSlug = getConfiguredAgenticMerchantSlug();
  if (!merchantSlug) {
    return null;
  }
  const { data, error } = await client.rpc('resolve_agentic_merchant_context', {
    p_slug: merchantSlug,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row || typeof row !== 'object') {
    if (error) {
      logger.error({
        error: sanitizeForLog(error),
        message: 'Agentic merchant context RPC failed',
      });
    }
    return null;
  }
  const record = row as Record<string, unknown>;
  if (typeof record.id !== 'string') {
    return null;
  }
  const requestControls = readAgenticRequestControls(record.custom_settings);
  return {
    agent_user_agent_allowlist: requestControls.allowlist,
    agent_user_agent_denylist: requestControls.denylist,
    agentic_checkout_enabled: record.agentic_checkout_enabled !== false,
    business_name:
      typeof record.business_name === 'string' ? record.business_name : null,
    custom_domain:
      typeof record.custom_domain === 'string' && record.custom_domain.trim()
        ? record.custom_domain.trim()
        : undefined,
    id: record.id,
    pay_on_delivery_enabled: record.pay_on_delivery_enabled === true,
    paystack_subaccount_code:
      typeof record.paystack_subaccount_code === 'string'
        ? record.paystack_subaccount_code
        : null,
    slug: typeof record.slug === 'string' ? record.slug : merchantSlug,
  };
}

export async function resolveAgenticMerchantContext(
  supabase: SupabaseClient
): Promise<AgenticMerchantContext | null> {
  const merchantSlug = getConfiguredAgenticMerchantSlug();
  if (!merchantSlug) {
    return null;
  }

  // NOTE: `merchants` has no `custom_domain` column — custom domains are
  // normalized into `public.domains`. Selecting it here would make PostgREST
  // reject the whole query and resolve the context to null.
  const { data, error } = await supabase
    .from('merchants')
    .select('id, slug, business_name, paystack_subaccount_code')
    .eq('slug', merchantSlug)
    .maybeSingle();

  if (error || !data || typeof data.id !== 'string') {
    return null;
  }

  // Source the merchant's custom domain from public.domains (primary, active),
  // mirroring getCachedMerchant. Best-effort: a miss or error simply leaves
  // custom_domain undefined rather than failing the whole context — but log
  // an error so a real domains permission/connection problem isn't invisible.
  const { data: primaryDomain, error: primaryDomainError } = await supabase
    .from('domains')
    .select('domain')
    .eq('merchant_id', data.id)
    .eq('is_primary', true)
    .eq('status', 'active')
    .maybeSingle();

  if (primaryDomainError) {
    logger.warn({
      error: sanitizeForLog(primaryDomainError),
      merchantId: data.id,
      message: 'Agentic merchant primary domain lookup failed',
    });
  }

  const { data: featureSettings, error: featureSettingsError } = await supabase
    .from('merchant_feature_settings')
    .select(
      'agentic_checkout_enabled, pay_on_delivery_enabled, custom_settings'
    )
    .eq('merchant_id', data.id)
    .maybeSingle();

  if (featureSettingsError) {
    logger.error({
      error: sanitizeForLog(featureSettingsError),
      merchantId: data.id,
      message: 'Agentic merchant feature settings lookup failed',
    });
  }

  const requestControls = readAgenticRequestControls(
    featureSettings?.custom_settings
  );

  return {
    agent_user_agent_allowlist: requestControls.allowlist,
    agent_user_agent_denylist: requestControls.denylist,
    agentic_checkout_enabled: featureSettingsError
      ? false
      : featureSettings?.agentic_checkout_enabled !== false,
    business_name:
      typeof data.business_name === 'string' ? data.business_name : null,
    custom_domain:
      typeof primaryDomain?.domain === 'string' && primaryDomain.domain.trim()
        ? primaryDomain.domain.trim()
        : undefined,
    id: data.id,
    pay_on_delivery_enabled:
      !featureSettingsError &&
      featureSettings?.pay_on_delivery_enabled === true,
    paystack_subaccount_code:
      typeof data.paystack_subaccount_code === 'string'
        ? data.paystack_subaccount_code
        : null,
    slug: typeof data.slug === 'string' ? data.slug : merchantSlug,
  };
}
