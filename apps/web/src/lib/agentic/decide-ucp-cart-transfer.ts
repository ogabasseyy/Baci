import {
  type MerchantFeatureSource,
  merchantHasFeature,
} from '@/lib/merchant-has-feature';

export type UcpCartTransferReadinessReason =
  | 'shared_cart_not_enrolled'
  | 'signed_agent_access_unavailable';

/**
 * Decides whether a merchant's UCP profile may declare cart transfer. Only
 * the canonical shared cart issues a redeemable handoff; the legacy fallback
 * links to `?agentic_cart_id=`, which nothing reads (F34). Cart transfer is
 * independent of native checkout and implies no payment capability.
 */
export function decideUcpCartTransfer({
  merchant,
  signedAgentReadsEnabled,
}: {
  merchant: MerchantFeatureSource;
  signedAgentReadsEnabled: boolean;
}): { ready: boolean; reasons: UcpCartTransferReadinessReason[] } {
  const reasons: UcpCartTransferReadinessReason[] = [];
  if (!signedAgentReadsEnabled) {
    reasons.push('signed_agent_access_unavailable');
  }
  if (!merchantHasFeature(merchant, 'shared_cart')) {
    reasons.push('shared_cart_not_enrolled');
  }
  return { ready: reasons.length === 0, reasons };
}
