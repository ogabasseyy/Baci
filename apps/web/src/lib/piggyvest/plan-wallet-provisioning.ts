import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PiggyvestApiError, type PiggyvestClientConfig } from './client';
import { createPiggyvestCustomer } from './customers';
import {
  PlanWalletError,
  type PlanWalletScope,
  type PlanWalletSnapshot,
  parsePlanWalletScope,
  readMappingRow,
  snapshotForRow,
} from './plan-wallets';
import { createPiggyvestWallet, listPiggyvestWallets } from './wallets';

/**
 * Plan-wallet provisioning: Baci customer/merchant -> provider wallet.
 *
 * Money-flow rules enforced here:
 * - One wallet per (customer, merchant). `subaccount_name` derives
 *   deterministically from those ids. The unique constraint collapses
 *   concurrent mapping writes, but it cannot stop two racing requests from
 *   each minting a provider wallet — so after provisioning the customer we
 *   reconcile against the provider list BEFORE creating, and again after a
 *   network error. This narrows the double-mint window to a true
 *   same-instant race; without a distributed lock it cannot reach zero, so
 *   orphaned provider wallets stay a known, monitored residual (a minted
 *   but unmapped wallet can receive funds no snapshot surfaces — reconcile
 *   by deterministic name during support).
 * - A create POST that times out means UNKNOWN, never failed (observed
 *   live on staging: the wallet was minted despite our 30s timeout).
 * - Provider customer provisioning uses synthetic KYC only behind the
 *   staging flag, which refuses production unconditionally. No real KYC
 *   and no provider secrets cross this module's logs.
 */

const SYNTHETIC_BVN = '00000000000';
const SYNTHETIC_NAME = 'STAGING TEST CUSTOMER';
const SYNTHETIC_PHONE = '+2348000000000';

function subaccountNameFor(scope: PlanWalletScope): string {
  return `BACI PLAN ${scope.merchantId.slice(0, 8)} ${scope.customerId.slice(0, 8)}`.toUpperCase();
}

function thirdPartyIdentifierFor(scope: PlanWalletScope): string {
  return `baci:${scope.merchantId}:${scope.customerId}`;
}

function syntheticEmailFor(scope: PlanWalletScope): string {
  return `plan-${scope.customerId.slice(0, 8)}-${scope.merchantId.slice(0, 8)}@example.com`;
}

async function reconcileExistingWallet(
  config: PiggyvestClientConfig,
  piggyvestCustomerId: string,
  subaccountName: string
): Promise<string | null> {
  const edges = await listPiggyvestWallets(config, {
    customerId: piggyvestCustomerId,
  });
  return edges.find((edge) => edge.name === subaccountName)?.id ?? null;
}

export async function ensurePlanWallet(
  supabase: SupabaseClient,
  config: PiggyvestClientConfig | null,
  scope: PlanWalletScope,
  options: { syntheticKycEnabled: boolean }
): Promise<PlanWalletSnapshot> {
  const parsedScope = parsePlanWalletScope(scope);
  if (!config) {
    throw new PlanWalletError(
      'PLAN_WALLET_NOT_CONFIGURED',
      'PiggyVest is not configured'
    );
  }
  const existing = await readMappingRow(supabase, parsedScope);
  if (existing) return snapshotForRow(supabase, config, existing);

  if (!options.syntheticKycEnabled) {
    throw new PlanWalletError(
      'PLAN_WALLET_KYC_UNAVAILABLE',
      'Customer provisioning is unavailable'
    );
  }

  const subaccountName = subaccountNameFor(parsedScope);
  let piggyvestCustomerId: string;
  let walletId: string;
  try {
    const customer = await createPiggyvestCustomer(config, {
      bvn: SYNTHETIC_BVN,
      email: syntheticEmailFor(parsedScope),
      name: SYNTHETIC_NAME,
      phone: SYNTHETIC_PHONE,
      thirdPartyIdentifier: thirdPartyIdentifierFor(parsedScope),
    });
    piggyvestCustomerId = customer.customer_id;
    const alreadyMinted = await reconcileExistingWallet(
      config,
      piggyvestCustomerId,
      subaccountName
    );
    if (alreadyMinted) {
      walletId = alreadyMinted;
    } else {
      try {
        walletId = (
          await createPiggyvestWallet(config, {
            subaccountName,
            customerId: piggyvestCustomerId,
            reserveVirtualAccount: true,
          })
        ).id;
      } catch (error) {
        if (
          error instanceof PiggyvestApiError &&
          error.code === 'PIGGYVEST_NETWORK_ERROR'
        ) {
          const reconciled = await reconcileExistingWallet(
            config,
            piggyvestCustomerId,
            subaccountName
          );
          if (!reconciled) throw error;
          walletId = reconciled;
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    throw new PlanWalletError(
      'PLAN_WALLET_PROVIDER_ERROR',
      error instanceof PiggyvestApiError ? error.message : 'Provisioning failed'
    );
  }

  const { error: insertError } = await supabase
    .from('piggyvest_plan_wallets')
    .upsert(
      {
        customer_id: parsedScope.customerId,
        merchant_id: parsedScope.merchantId,
        piggyvest_customer_id: piggyvestCustomerId,
        wallet_id: walletId,
        subaccount_name: subaccountName,
        status: 'provisioning',
      },
      { onConflict: 'customer_id,merchant_id', ignoreDuplicates: true }
    );
  if (insertError) {
    throw new PlanWalletError(
      'PLAN_WALLET_STORAGE_ERROR',
      'Plan wallet record failed'
    );
  }

  const row = await readMappingRow(supabase, parsedScope);
  if (!row) {
    throw new PlanWalletError(
      'PLAN_WALLET_STORAGE_ERROR',
      'Plan wallet record missing'
    );
  }
  return snapshotForRow(supabase, config, row);
}
