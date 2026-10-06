import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import z from 'zod';
import { PiggyvestApiError, type PiggyvestClientConfig } from './client';
import { retrievePiggyvestWallet } from './wallets';

/**
 * Plan-wallet restriction flips.
 *
 * Money-flow rules enforced here:
 * - A flip requires positive wallet attribution (`pvb_wallet` or
 *   `eventData.wallet_id`). Unattributed restriction events ack without
 *   flipping any row: restricting the wrong wallet (or every wallet) is
 *   worse than restricting none.
 * - Restriction applies immediately on `restriction-created.success` — a
 *   restricted wallet blocks outbound transfers until lifted.
 * - A lift re-derives status from a live provider retrieve (active maps
 *   to ready, anything else to provisioning) instead of assuming ready.
 *   Without provider config it falls back to provisioning, which the next
 *   snapshot read re-derives.
 * - Unknown wallets report 'unknown-wallet' without flipping; the
 *   webhook processor converts that to a retryable RESTRICTION_UNMAPPED
 *   failure (same mapping race as the inflow ledger's unmapped path) so a
 *   restriction arriving before its mapping row commits is redelivered
 *   rather than silently dropped.
 * - Staging goal wallets (recorded only in
 *   piggyvest_staging.wallet_goal_mappings) flip through the service-role-only
 *   apply_staging_wallet_restriction bridge when the legacy table misses.
 *   The flip trusts the HMAC-verified provider event symmetrically in both
 *   directions; only exactly-one-enabled-mapping wallets flip, so unknown or
 *   ambiguous wallets keep the retryable unknown-wallet path instead of
 *   flipping the wrong row.
 */

export class PlanWalletRestrictionError extends Error {
  readonly code:
    | 'RESTRICTION_UNATTRIBUTED'
    | 'RESTRICTION_UNMAPPED'
    | 'RESTRICTION_STORAGE_ERROR'
    | 'RESTRICTION_PROVIDER_ERROR';

  constructor(code: PlanWalletRestrictionError['code'], message: string) {
    super(message);
    this.name = 'PlanWalletRestrictionError';
    this.code = code;
  }
}

const attributionSchema = z.object({
  pvb_wallet: z.string().min(1).optional(),
  eventData: z.looseObject({}),
});

export function attributedWalletId(event: {
  pvb_wallet?: string;
  eventData: Record<string, unknown>;
}): string | null {
  const parsed = attributionSchema.safeParse(event);
  if (!parsed.success) return null;
  if (parsed.data.pvb_wallet) return parsed.data.pvb_wallet;
  const fromData = parsed.data.eventData.wallet_id;
  return typeof fromData === 'string' && fromData.length > 0 ? fromData : null;
}

async function flipStatus(
  supabase: SupabaseClient,
  walletId: string,
  status: 'restricted' | 'ready' | 'provisioning'
): Promise<boolean> {
  const { data, error } = await supabase
    .from('piggyvest_plan_wallets')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('wallet_id', walletId)
    .select('wallet_id');
  if (error) {
    throw new PlanWalletRestrictionError(
      'RESTRICTION_STORAGE_ERROR',
      'Restriction flip failed'
    );
  }
  return data !== null && data.length > 0;
}

async function hasLegacyWallet(
  supabase: SupabaseClient,
  walletId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('piggyvest_plan_wallets')
    .select('wallet_id')
    .eq('wallet_id', walletId)
    .maybeSingle();
  if (error) {
    throw new PlanWalletRestrictionError(
      'RESTRICTION_STORAGE_ERROR',
      'Restriction lookup failed'
    );
  }
  return data !== null;
}

async function flipStagingStatus(
  supabase: SupabaseClient,
  walletId: string,
  status: 'ready' | 'restricted'
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    'apply_staging_wallet_restriction',
    {
      p_provider_wallet_id: walletId,
      p_restriction_status: status,
    }
  );
  if (error) {
    throw new PlanWalletRestrictionError(
      'RESTRICTION_STORAGE_ERROR',
      'Restriction flip failed'
    );
  }
  return data === true;
}

export async function applyRestrictionCreated(
  supabase: SupabaseClient,
  walletId: string
): Promise<'restricted' | 'unknown-wallet'> {
  const id = z.string().min(1).parse(walletId);
  if (await flipStatus(supabase, id, 'restricted')) return 'restricted';
  return (await flipStagingStatus(supabase, id, 'restricted'))
    ? 'restricted'
    : 'unknown-wallet';
}

export async function applyRestrictionLifted(
  supabase: SupabaseClient,
  config: PiggyvestClientConfig | null,
  walletId: string
): Promise<'ready' | 'provisioning' | 'unknown-wallet'> {
  const id = z.string().min(1).parse(walletId);
  // Ownership first: the live retrieve below uses the production client,
  // which 404s for staging-only wallets. Probing avoids turning every
  // staging lift into a provider error.
  if (!(await hasLegacyWallet(supabase, id))) {
    // No live re-derive for staging: the webhook path carries no staging
    // provider config, and the HMAC-verified lift event is itself the
    // provider's signal. Funding-accounts retrieval independently verifies
    // live wallet status on every call, so a prematurely lifted row still
    // cannot receive accounts until the provider reports active.
    return (await flipStagingStatus(supabase, id, 'ready'))
      ? 'ready'
      : 'unknown-wallet';
  }
  let status: 'ready' | 'provisioning' = 'provisioning';
  if (config) {
    try {
      const wallet = await retrievePiggyvestWallet(config, id);
      status = wallet.status === 'active' ? 'ready' : 'provisioning';
    } catch (error) {
      throw new PlanWalletRestrictionError(
        'RESTRICTION_PROVIDER_ERROR',
        error instanceof PiggyvestApiError
          ? error.message
          : 'Wallet read failed'
      );
    }
  }
  if (await flipStatus(supabase, id, status)) return status;
  return (await flipStagingStatus(supabase, id, 'ready'))
    ? 'ready'
    : 'unknown-wallet';
}
