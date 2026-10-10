import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import z from 'zod';

/**
 * Provider-to-Baci plan-wallet mapping proof (leaf module: no sibling
 * lib imports, so ledgers can depend on it without a cycle).
 */

export class PlanWalletError extends Error {
  readonly code:
    | 'PLAN_WALLET_NOT_CONFIGURED'
    | 'PLAN_WALLET_KYC_UNAVAILABLE'
    | 'PLAN_WALLET_PROVIDER_ERROR'
    | 'PLAN_WALLET_STORAGE_ERROR';

  constructor(code: PlanWalletError['code'], message: string) {
    super(message);
    this.name = 'PlanWalletError';
    this.code = code;
  }
}

const mappingRowSchema = z.object({
  customer_id: z.string().min(1),
  merchant_id: z.string().min(1),
  piggyvest_customer_id: z.string().min(1),
  wallet_id: z.string().min(1),
  status: z.enum(['provisioning', 'ready', 'restricted']),
});

export type PlanWalletMapping = z.infer<typeof mappingRowSchema>;

/**
 * A financial write is allowed only when the event's provider
 * (customer, wallet) pair resolves to a known plan-wallet mapping row.
 * The lookup is by the unique wallet_id; the provider customer id is
 * verified in code so a customer mismatch (wrong tenant, confused
 * deputy) resolves to null instead of another tenant's row. A wallet
 * the shared table does not know falls through to the staging binding
 * bridge: dedicated per-goal wallets are recorded there at provisioning
 * time, and the bridge answers only for exactly one enabled mapping.
 * Callers treat null as retryable-unmapped: the creation webhook may
 * legitimately arrive before the mapping write.
 */
export async function resolvePlanWalletMapping(
  supabase: SupabaseClient,
  input: { piggyvestCustomerId: string; walletId: string }
): Promise<PlanWalletMapping | null> {
  const parsed = z
    .object({
      piggyvestCustomerId: z.string().min(1),
      walletId: z.string().min(1),
    })
    .parse(input);
  const { data, error } = await supabase
    .from('piggyvest_plan_wallets')
    .select(
      'customer_id, merchant_id, piggyvest_customer_id, wallet_id, status'
    )
    .eq('wallet_id', parsed.walletId)
    .maybeSingle();
  if (error) {
    throw new PlanWalletError(
      'PLAN_WALLET_STORAGE_ERROR',
      'Plan wallet mapping lookup failed'
    );
  }
  if (!data) return resolveStagingWalletBinding(supabase, parsed);
  const row = mappingRowSchema.safeParse(data);
  if (!row.success) {
    throw new PlanWalletError(
      'PLAN_WALLET_STORAGE_ERROR',
      'Plan wallet mapping record is invalid'
    );
  }
  if (row.data.piggyvest_customer_id !== parsed.piggyvestCustomerId) {
    return null;
  }
  return row.data;
}

const stagingOwnerRowSchema = z.object({
  customer_id: z.string().min(1),
  merchant_id: z.string().min(1),
});

/**
 * Second-chance resolution for dedicated per-goal wallets via the
 * service-role-only `resolve_staging_wallet_owner` bridge. The bridge
 * matches the full (wallet, customer) pair server-side and answers only
 * for exactly one enabled mapping, so a returned row is already
 * tenant-verified; anything else (unknown wallet, ambiguity, transport
 * failure shape) resolves to null and stays retryable-unmapped. Only a
 * hard RPC error is a storage error.
 */
async function resolveStagingWalletBinding(
  supabase: SupabaseClient,
  parsed: { piggyvestCustomerId: string; walletId: string }
): Promise<PlanWalletMapping | null> {
  const { data, error } = await supabase.rpc('resolve_staging_wallet_owner', {
    p_provider_customer_id: parsed.piggyvestCustomerId,
    p_provider_wallet_id: parsed.walletId,
  });
  if (error) {
    throw new PlanWalletError(
      'PLAN_WALLET_STORAGE_ERROR',
      'Staging wallet binding lookup failed'
    );
  }
  if (!Array.isArray(data) || data.length !== 1) return null;
  const owner = stagingOwnerRowSchema.safeParse(data[0]);
  if (!owner.success) {
    throw new PlanWalletError(
      'PLAN_WALLET_STORAGE_ERROR',
      'Staging wallet binding record is invalid'
    );
  }
  return {
    customer_id: owner.data.customer_id,
    merchant_id: owner.data.merchant_id,
    piggyvest_customer_id: parsed.piggyvestCustomerId,
    wallet_id: parsed.walletId,
    status: 'ready',
  };
}
