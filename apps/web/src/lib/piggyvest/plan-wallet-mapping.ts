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
 * deputy) resolves to null instead of another tenant's row. Callers
 * treat null as retryable-unmapped: the creation webhook may
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
  if (!data) return null;
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
