import type { SupabaseClient } from '@supabase/supabase-js';
import type { VtuTransactionRow } from '@/lib/vtu-fulfillment';
import { setMetadataValue } from '@/lib/vtu-metadata-fields';
import {
  getVtuProviderLabel,
  type PaymentSplit,
} from '@/lib/vtu-payment-split';
import { VTU_TYPE_LABELS } from '@/lib/vtu-pending-transaction';
import { throwVtuPersistenceError } from '@/lib/vtu-persistence-error';

/**
 * Failed-vend refund branches, moved here from vtu-fulfillment
 * (Codex R106 P1) per the 300-line ceiling. The dispatcher lives
 * in vtu-fulfillment-refund; the submitted-row ledger lookup rides
 * along because both refund callers (dispatcher + retry guard)
 * need it.
 */
export interface RefundBranchInput {
  metadata: Record<string, unknown>;
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}

export interface RefundBranchResult {
  metadataChanged: boolean;
  refundIssued: boolean;
  refundedAmount: number;
}

export function applyRefundMetadata(
  metadata: Record<string, unknown>,
  refundAmount: number,
  refundContextLabel: string
): boolean {
  let metadataChanged = setMetadataValue(metadata, 'refundIssued', true);
  metadataChanged =
    setMetadataValue(metadata, 'refundAmount', refundAmount) || metadataChanged;
  metadataChanged =
    setMetadataValue(metadata, 'refundedAt', new Date().toISOString()) ||
    metadataChanged;
  metadataChanged =
    setMetadataValue(metadata, 'refundContext', refundContextLabel) ||
    metadataChanged;
  return metadataChanged;
}

export async function refundHybridKudaFailure({
  metadata,
  row,
  supabase,
  paymentSplit,
}: RefundBranchInput & {
  paymentSplit: PaymentSplit;
}): Promise<RefundBranchResult> {
  // Reverse the wallet leg first (idempotent at the RPC layer).
  const { error: reverseError } = await supabase.rpc(
    'reverse_vtu_wallet_payment',
    {
      p_vtu_transaction_id: row.id,
      p_reason: `VTU vend failed: ${VTU_TYPE_LABELS[row.type]} ${getVtuProviderLabel(row)}`,
      p_merchant_id: row.merchant_id,
    }
  );
  if (reverseError) {
    console.error('Failed to reverse VTU wallet portion:', {
      customerId: row.customer_id,
      error: reverseError.message,
      merchantId: row.merchant_id,
      rpc: 'reverse_vtu_wallet_payment',
      transactionId: row.id,
    });
    return { metadataChanged: false, refundIssued: false, refundedAmount: 0 };
  }
  // Card portion refund (only if there was a card leg).
  if (paymentSplit.card > 0) {
    const { error: refundError } = await supabase.rpc(
      'refund_customer_wallet_for_vtu',
      {
        p_customer_id: row.customer_id,
        p_merchant_id: row.merchant_id,
        p_amount: paymentSplit.card,
        p_vtu_transaction_id: row.id,
        p_description: `Refund (card portion) for failed ${VTU_TYPE_LABELS[row.type]} ${getVtuProviderLabel(row)} purchase`,
      }
    );
    if (refundError) {
      console.error('Failed to refund VTU card portion to customer wallet:', {
        amount: paymentSplit.card,
        customerId: row.customer_id,
        error: refundError.message,
        merchantId: row.merchant_id,
        rpc: 'refund_customer_wallet_for_vtu',
        transactionId: row.id,
      });
      return { metadataChanged: false, refundIssued: false, refundedAmount: 0 };
    }
  }
  // Both legs were reversed above (wallet unconditionally, card when
  // present). Persist the card leg only (Codex R98 P2): the history
  // projector sums it with the split's wallet leg, so persisting the
  // total here would double-count. The immediate response below
  // reports the total instead — card-only reporting serialized
  // refundedToWallet: 0 for wallet-only splits (card: 0) even though
  // the full purchase amount was restored.
  const metadataChanged = applyRefundMetadata(
    metadata,
    paymentSplit.card,
    'hybrid_vend_failure'
  );
  return {
    metadataChanged,
    refundIssued: true,
    refundedAmount: paymentSplit.wallet + paymentSplit.card,
  };
}

export async function refundHybridWalletRace({
  metadata,
  row,
  supabase,
  paymentSplit,
}: RefundBranchInput & {
  paymentSplit: PaymentSplit;
}): Promise<RefundBranchResult> {
  // Wallet-only race (paymentSplit.card === 0): nothing to refund. Mark
  // the row refunded for visibility but do NOT call the refund RPC — the
  // wallet was never debited and no gateway charge was collected.
  if (paymentSplit.card <= 0) {
    const metadataChanged = applyRefundMetadata(
      metadata,
      0,
      'wallet_only_race'
    );
    return { metadataChanged, refundIssued: true, refundedAmount: 0 };
  }
  const { error: raceRefundError } = await supabase.rpc(
    'refund_customer_wallet_for_vtu',
    {
      p_customer_id: row.customer_id,
      p_merchant_id: row.merchant_id,
      p_amount: paymentSplit.card,
      p_vtu_transaction_id: row.id,
      p_description: `Wallet balance changed during checkout — card portion refunded for ${VTU_TYPE_LABELS[row.type]} ${getVtuProviderLabel(row)}`,
    }
  );
  if (raceRefundError) {
    console.error(
      'Failed to refund VTU card portion (wallet race) to customer wallet:',
      {
        amount: paymentSplit.card,
        customerId: row.customer_id,
        error: raceRefundError.message,
        merchantId: row.merchant_id,
        rpc: 'refund_customer_wallet_for_vtu',
        transactionId: row.id,
      }
    );
    return { metadataChanged: false, refundIssued: false, refundedAmount: 0 };
  }
  const metadataChanged = applyRefundMetadata(
    metadata,
    paymentSplit.card,
    'wallet_race'
  );
  return {
    metadataChanged,
    refundIssued: true,
    refundedAmount: paymentSplit.card,
  };
}

export async function refundCardOnly({
  metadata,
  row,
  supabase,
  totalAmount,
}: RefundBranchInput & { totalAmount: number }): Promise<RefundBranchResult> {
  const { error } = await supabase.rpc('refund_customer_wallet_for_vtu', {
    p_customer_id: row.customer_id,
    p_merchant_id: row.merchant_id,
    p_amount: totalAmount,
    p_vtu_transaction_id: row.id,
    p_description: `Refund for failed ${VTU_TYPE_LABELS[row.type]} ${getVtuProviderLabel(row)} purchase ₦${row.amount}`,
  });
  if (error) {
    console.error('Failed to refund VTU payment to customer wallet:', {
      amount: totalAmount,
      customerId: row.customer_id,
      error: error.message,
      merchantId: row.merchant_id,
      rpc: 'refund_customer_wallet_for_vtu',
      transactionId: row.id,
    });
    return { metadataChanged: false, refundIssued: false, refundedAmount: 0 };
  }
  // Use the shared helper so all three refund branches write
  // metadata (refundIssued / refundAmount / refundedAt / refundContext)
  // the same way. Without this an ops query like "find refunds where
  // refundContext=card_only" would miss this path's rows.
  const metadataChanged = applyRefundMetadata(
    metadata,
    totalAmount,
    'card_only'
  );
  return { metadataChanged, refundIssued: true, refundedAmount: totalAmount };
}

export async function findExistingVtuRefundLedger({
  row,
  supabase,
}: {
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}): Promise<{ amount: number } | null> {
  if (!row.customer_id) return null;
  const { data, error } = await supabase
    .from('customer_wallet_transactions')
    .select('amount')
    .eq('customer_id', row.customer_id)
    .eq('merchant_id', row.merchant_id)
    .eq('source_type', 'vtu_transaction_refund')
    .eq('source_id', row.id)
    .eq('type', 'refund')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    // Fail closed: if we can't verify whether a refund row already exists,
    // do NOT proceed with a retry — that's the path that would double-credit.
    throwVtuPersistenceError(
      `Failed to verify VTU refund ledger before retry: ${error.message}`
    );
  }
  if (!data) return null;
  return { amount: Number(data.amount) || 0 };
}
