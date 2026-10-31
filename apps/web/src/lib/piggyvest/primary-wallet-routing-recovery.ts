import 'server-only';
import { piggyvestInterestPayoutWalletIdSchema } from '@/schemas/piggyvest-primary-wallet-onboarding';
import { piggyvestPrimaryWalletStoreSchemas as schemas } from '@/schemas/piggyvest-primary-wallet-store';
import { readPrimaryWalletInterestRouting } from './primary-wallet-interest-routing';
import type { PrimaryWalletIntentScope } from './primary-wallet-onboarding.types';
import { PRIMARY_WALLET_STATEMENTS } from './primary-wallet-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

export type PrimaryWalletRoutingRecovery =
  | 'none'
  | 'pending'
  | 'promoted'
  | 'rejected'
  | 'unavailable';

/**
 * Finishes onboarding for a main wallet that was created but whose interest
 * routing was not readable yet (routing_pending: ids kept, never usable).
 * Read-only towards PiggyVest: it re-reads the existing wallet and never
 * creates a customer. Proven routing makes it accepted (usable); a
 * contradiction makes it rejected (terminal review) and alerts operations;
 * anything else leaves it pending for the next refresh.
 */
export async function recoverPrimaryWalletRouting(input: {
  scope: PrimaryWalletIntentScope;
  execute: PiggyvestProvisioningExecutor;
  payoutWalletId: string;
  retrieveWallet: (walletId: string) => Promise<unknown>;
}): Promise<PrimaryWalletRoutingRecovery> {
  const scope = schemas.scope.safeParse(input.scope);
  const payoutWalletId = piggyvestInterestPayoutWalletIdSchema.safeParse(
    input.payoutWalletId
  );
  if (!scope.success || !payoutWalletId.success) return 'unavailable';
  const scopeJson = JSON.stringify(scope.data);
  let pending: { providerCustomerId: string; providerWalletId: string } | null;
  try {
    const response = await input.execute(
      PRIMARY_WALLET_STATEMENTS.readRouting,
      [scopeJson]
    );
    pending = schemas.routingRows.parse(response.rows)[0].result;
  } catch {
    return 'unavailable';
  }
  if (!pending) return 'none';
  const routing = await readPrimaryWalletInterestRouting({
    walletId: pending.providerWalletId,
    customerId: pending.providerCustomerId,
    businessId: scope.data.businessId,
    payoutWalletId: payoutWalletId.data,
    retrieveWallet: input.retrieveWallet,
  });
  if (routing === 'unreadable' || routing === 'unsettled') return 'pending';
  const routed = routing === 'routed';
  let resolved: boolean;
  try {
    const response = await input.execute(
      PRIMARY_WALLET_STATEMENTS.resolveRouting,
      [scopeJson, JSON.stringify(pending), String(routed)]
    );
    resolved = schemas.recordedRows.parse(response.rows)[0].result;
  } catch {
    return 'unavailable';
  }
  // Another request resolved it first: the snapshot read decides.
  if (!resolved) return 'pending';
  if (routed) return 'promoted';
  emitPiggyvestWebhookAlert('PIGGYVEST_PRIMARY_ROUTING_NEEDS_REVIEW', {
    reason: 'main wallet interest routing contradicted on recheck',
  });
  return 'rejected';
}
