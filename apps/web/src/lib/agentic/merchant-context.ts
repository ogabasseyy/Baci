import {
  getAgenticApiKey,
  getAgenticConfirmationKeys,
  getAgenticMerchantSlug,
  getAgenticSigningKeys,
} from '@/env';
import { readAgenticRequestControls } from '@/lib/agentic/agent-request-controls';
import { hasUsableAgenticJwtSigningMaterial } from '@/lib/agentic/jwt-signing-material';
import { createAgenticMerchantContextClient } from '@/lib/agentic/scoped-supabase';
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
    functionName:
      | 'resolve_agentic_merchant_context'
      | 'resolve_agentic_merchant_payment_split',
    args: { p_slug: string }
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

type AgenticPaymentSplitResult =
  | { ok: true; paystackSubaccountCode: string | null }
  | { ok: false };

/**
 * Resolves the configured merchant through the narrowly scoped
 * SECURITY DEFINER projection instead of a service-role client, so
 * user-facing agentic routes never bypass RLS to read merchant config.
 * The projection withholds the Paystack subaccount; checkout completion
 * opts into the separate payment-split RPC with `includePaymentSplit`.
 */
export async function resolveAgenticMerchantContextFromRpc({
  includePaymentSplit = false,
}: {
  includePaymentSplit?: boolean;
} = {}): Promise<AgenticMerchantContext | null> {
  const merchantSlug = getConfiguredAgenticMerchantSlug();
  if (!merchantSlug) {
    return null;
  }
  const normalizedSlug = merchantSlug.trim().toLowerCase();
  const contextClient: AgenticMerchantContextRpcClient =
    createAgenticMerchantContextClient(normalizedSlug);
  const { data, error } = await contextClient.rpc(
    'resolve_agentic_merchant_context',
    {
      p_slug: normalizedSlug,
    }
  );
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
  const requestControls = readAgenticRequestControls({
    agentic_agent_allowlist: record.agent_allowlist,
    agentic_agent_denylist: record.agent_denylist,
  });
  const context: AgenticMerchantContext = {
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
  if (!includePaymentSplit) {
    return context;
  }
  const paymentSplit = await readAgenticPaymentSplit(
    contextClient,
    normalizedSlug
  );
  if (!paymentSplit.ok) {
    return null;
  }
  return {
    ...context,
    paystack_subaccount_code: paymentSplit.paystackSubaccountCode,
  };
}

async function readAgenticPaymentSplit(
  contextClient: AgenticMerchantContextRpcClient,
  slug: string
): Promise<AgenticPaymentSplitResult> {
  const { data, error } = await contextClient.rpc(
    'resolve_agentic_merchant_payment_split',
    { p_slug: slug }
  );
  if (error) {
    logger.error({
      error: sanitizeForLog(error),
      message: 'Agentic merchant payment split RPC failed',
    });
    return { ok: false };
  }
  const row = Array.isArray(data) ? data[0] : null;
  const code =
    row && typeof row === 'object'
      ? (row as Record<string, unknown>).paystack_subaccount_code
      : null;
  return {
    ok: true,
    paystackSubaccountCode: typeof code === 'string' ? code : null,
  };
}
