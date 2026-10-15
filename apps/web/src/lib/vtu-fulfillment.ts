import type { SupabaseClient } from '@supabase/supabase-js';
import { getRootDomain } from '@/env';
import { notifyCustomer } from '@/lib/expo-push';
import {
  formatPhoneNumber,
  isValidPhoneNumber,
  checkTransactionStatus as kudaCheckTransactionStatus,
  type PurchaseResult,
  purchaseAirtime,
  purchaseData,
} from '@/lib/kuda';
import { purchaseBill } from '@/lib/kuda-bills';
import {
  checkTransactionStatus as monnifyCheckTransactionStatus,
  purchaseBill as monnifyPurchaseBill,
} from '@/lib/monnify-bills';
import { normalizeVtuNetworkProvider } from '@/lib/normalize-vtu-network-provider';
import { resolveConcurrentFailedVtuTransaction } from '@/lib/vtu-concurrent-failed-refund';
import {
  isVtuConcurrentUpdateError,
  VtuConcurrentUpdateError,
} from '@/lib/vtu-concurrent-update-error';
import type {
  CustomerEmailClaimLease,
  CustomerEmailNotificationState,
} from '@/lib/vtu-email-claim-lease';
import {
  getCustomerEmailAttemptedAtKey,
  getCustomerEmailClaimLeaseGeneration,
  isCustomerEmailClaimLeaseExpired,
} from '@/lib/vtu-email-claim-lease';
import {
  getSafeMetadataDiagnostics,
  VTU_CUSTOMER_FAILURE_MESSAGE,
  VTU_CUSTOMER_SAFE_ERROR_MESSAGE_KEY,
} from '@/lib/vtu-metadata-fields';
import {
  throwVtuPersistenceError,
  VtuPersistenceError,
} from '@/lib/vtu-persistence-error';

export { VtuPersistenceError };

import {
  applyKudaFallbackCreditCorrection,
  refreshSnapshotMoneyColumns,
} from '@/lib/vtu-fallback-credit-correction';
import { awardVtuAirtimeLoyaltyPoints } from '@/lib/vtu-loyalty-points-award';
import { executeMonnifyAirtimeKudaFallback } from '@/lib/vtu-monnify-kuda-fallback';
import { VTU_TYPE_LABELS } from '@/lib/vtu-pending-transaction';
import { restoreInterruptedPreVendVtuRow } from '@/lib/vtu-pre-vend-recovery';
import {
  VTU_REFUND_SKIPPED_KEY,
  VTU_REFUND_SKIPPED_NO_COLLECTION,
} from '@/lib/vtu-refund-collection-evidence';
import {
  RetryableVtuError,
  throwIfVtuRefundUnconfirmed,
  throwUnlessRefundSkippedWithoutCollection,
} from '@/lib/vtu-refund-guard';
import {
  persistVtuWalletDebitConfirmation,
  recoverStrandedPreVendVtuRow,
  shouldSkipRefundWithoutCollectionEvidence,
  writeVtuProviderSubmissionMarkerOrRestore,
} from './vtu-fulfillment-recovery';
import { mergeVtuSettlementMetadata } from './vtu-settlement-metadata';

export type { RetryableVtuErrorContext } from '@/lib/vtu-refund-guard';
export { RetryableVtuError };

/**
 * Wire contract with `redeem_vtu_wallet_payment` (Phase B.1 migration).
 * The RPC raises `RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE =
 * 'insufficient_wallet_balance'` when the customer's wallet has dropped
 * below the requested debit amount between checkout-init and webhook.
 *
 * Callers MUST match on this exact MESSAGE string. ERRCODE 'P0001' is the
 * default for plpgsql RAISE without USING ERRCODE so code matching alone
 * is not sufficient.
 *
 * If you change this string, also update the migration:
 *   supabase/migrations/<ts>_redeem_vtu_wallet_payment.sql
 */
export const INSUFFICIENT_WALLET_BALANCE_MESSAGE =
  'insufficient_wallet_balance';

/**
 * Centralised matcher for the wallet-debit "insufficient balance" RPC
 * error. The migration's contract is that the RPC raises with
 * MESSAGE='insufficient_wallet_balance' (P0001). Today supabase-js
 * surfaces that string verbatim on `error.message`, but historical
 * versions have wrapped the raw PG message with extra context
 * (e.g. `ERROR: insufficient_wallet_balance\nWHERE: PL/pgSQL ...`).
 * Match both the strict and the wrapped form so a future supabase-js
 * bump can't silently route every wallet-race into the
 * non-balance-error branch (which would turn each insufficient-balance
 * into a `VtuPersistenceError` and a webhook retry loop instead of the
 * clean insufficient-funds path — wallet-only checkout has no card
 * portion to fall back to).
 */
export function isInsufficientWalletBalanceError(
  error: { message?: string; code?: string } | null | undefined
): boolean {
  const message = error?.message;
  if (!message) return false;
  if (message === INSUFFICIENT_WALLET_BALANCE_MESSAGE) return true;
  // Defense-in-depth: substring match scoped to P0001 errors so we
  // don't accidentally match the literal phrase appearing elsewhere.
  return (
    error?.code === 'P0001' &&
    message.includes(INSUFFICIENT_WALLET_BALANCE_MESSAGE)
  );
}

interface PaymentSplit {
  wallet: number;
  card: number;
}

function readPaymentSplit(
  metadata: Record<string, unknown> | null | undefined
): PaymentSplit | null {
  const split = metadata?.paymentSplit as Partial<PaymentSplit> | undefined;
  if (
    !split ||
    typeof split.wallet !== 'number' ||
    typeof split.card !== 'number'
  ) {
    return null;
  }
  return { wallet: split.wallet, card: split.card };
}

export interface VtuTransactionRow {
  amount: number;
  biller_item_code: string | null;
  biller_name: string | null;
  customer_cashback: number | null;
  customer_id: string | null;
  customer_identifier: string | null;
  error_message: string | null;
  id: string;
  merchant_commission: number | null;
  merchant_id: string;
  metadata: Record<string, unknown> | null;
  network_provider: string;
  phone_number: string;
  request_reference: string;
  source:
    | 'checkout'
    | 'loyalty_reward'
    | 'direct'
    | 'gift'
    | 'storefront_modal'
    | null;
  status: 'pending' | 'processing' | 'successful' | 'failed';
  transaction_id: string | null;
  type: 'airtime' | 'data' | 'electricity' | 'cable_tv' | 'betting';
  /** Last write; drives the stranded pre-vend staleness gate. */
  updated_at?: string | null;
  /** Creation time; excludes pre-marker legacy rows from recovery. */
  created_at?: string | null;
  /** Order link; collection evidence for legacy card rows. */
  order_id?: string | null;
}

interface CreditWalletResult {
  new_balance: unknown;
}

export type FulfilledVtuResult =
  | {
      amount: number;
      cashback?: { amount: number; credited: boolean; newBalance: number };
      customerIdentifier?: string;
      loyaltyPoints?: {
        credited: boolean;
        earned: number;
        newBalance?: number;
      };
      reference: string;
      status: 'successful';
      voucherPin?: string;
    }
  | {
      amount: number;
      error: string;
      reference: string;
      refundedToWallet?: number;
      status: 'failed';
    }
  | { amount: number; reference: string; status: 'processing' };

function getCustomerFirstName(row: VtuTransactionRow, merchantName: string) {
  if (
    typeof row.metadata?.customerName === 'string' &&
    row.metadata.customerName
  ) {
    return row.metadata.customerName;
  }

  return merchantName || 'Customer';
}

function normalizeCustomerPhoneForBill(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const formatted = formatPhoneNumber(value);
  return isValidPhoneNumber(formatted) ? formatted : undefined;
}

function getCustomerPhoneForBill(row: VtuTransactionRow) {
  return (
    normalizeCustomerPhoneForBill(row.metadata?.customerPhone) ??
    normalizeCustomerPhoneForBill(row.phone_number)
  );
}

function getProviderTransactionId(row: VtuTransactionRow) {
  const transactionId = row.transaction_id?.trim();
  return transactionId ? transactionId : null;
}

function getProcessingProviderResponseMessage(row: VtuTransactionRow) {
  const message = row.error_message?.trim();
  return message ? message : null;
}

function getVoucherPinFromMetadata(metadata: Record<string, unknown> | null) {
  return normalizeVoucherPin(metadata?.voucherPin);
}

const CUSTOMER_RECEIPT_EMAIL_ATTEMPTED_KEY =
  'customerReceiptEmailNotificationAttempted';
const CUSTOMER_RECEIPT_EMAIL_SENT_KEY = 'customerReceiptEmailNotificationSent';
const CUSTOMER_TOKEN_EMAIL_ATTEMPTED_KEY =
  'customerTokenEmailNotificationAttempted';
const CUSTOMER_TOKEN_EMAIL_SENT_KEY = 'customerTokenEmailNotificationSent';
const LEGACY_CUSTOMER_EMAIL_SENT_KEY = 'customerEmailNotificationSent';
const LEGACY_CUSTOMER_PENDING_TOKEN_EMAIL_SENT_KEY =
  'customerPendingTokenEmailNotificationSent';

function getCustomerEmailNotificationState({
  isTokenReady,
  type,
}: {
  isTokenReady: boolean;
  type: VtuTransactionRow['type'];
}): CustomerEmailNotificationState {
  if (canResolveBillVoucherPin(type) && isTokenReady) {
    return {
      attemptedKey: CUSTOMER_TOKEN_EMAIL_ATTEMPTED_KEY,
      sentKey: CUSTOMER_TOKEN_EMAIL_SENT_KEY,
    };
  }

  return {
    attemptedKey: CUSTOMER_RECEIPT_EMAIL_ATTEMPTED_KEY,
    legacySentKeys: [
      LEGACY_CUSTOMER_EMAIL_SENT_KEY,
      LEGACY_CUSTOMER_PENDING_TOKEN_EMAIL_SENT_KEY,
    ],
    sentKey: CUSTOMER_RECEIPT_EMAIL_SENT_KEY,
    sentWriteKeys: [LEGACY_CUSTOMER_EMAIL_SENT_KEY],
  };
}

function isCustomerEmailNotificationSent(
  metadata: Record<string, unknown>,
  state: CustomerEmailNotificationState
) {
  return (
    metadata[state.sentKey] === true ||
    (state.legacySentKeys?.some((key) => metadata[key] === true) ?? false)
  );
}

function setCustomerEmailNotificationResult({
  metadata,
  sent,
  state,
}: {
  metadata: Record<string, unknown>;
  sent: boolean;
  state: CustomerEmailNotificationState;
}) {
  let changed = setMetadataValue(metadata, state.sentKey, sent);
  for (const writeKey of state.sentWriteKeys ?? []) {
    changed = setMetadataValue(metadata, writeKey, sent) || changed;
  }
  // The attempted flag is released ONLY by the fenced clear RPC (Codex
  // R97 P2): zeroing it here would let the settlement merge persist a
  // release the RPC refused, unlocking a lease another path reclaimed.
  return changed;
}

function normalizeVoucherPin(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function canResolveBillVoucherPin(type: VtuTransactionRow['type']) {
  return type === 'electricity' || type === 'cable_tv' || type === 'betting';
}

function coerceNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isCreditWalletResult(value: unknown): value is CreditWalletResult {
  return typeof value === 'object' && value !== null && 'new_balance' in value;
}

function getCreditWalletNewBalance(data: unknown) {
  const result = Array.isArray(data)
    ? data.find((item) => isCreditWalletResult(item))
    : data;

  return isCreditWalletResult(result) ? result.new_balance : null;
}

function normalizeProviderStatus(status: string) {
  const normalized = status
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  if (
    normalized === 'completed' ||
    normalized === 'complete' ||
    normalized === 'success' ||
    normalized === 'successful'
  ) {
    return 'successful';
  }

  if (
    normalized === 'inprogress' ||
    normalized === 'pending' ||
    normalized === 'processing'
  ) {
    return 'processing';
  }

  if (
    normalized === 'failed' ||
    normalized === 'failure' ||
    normalized === 'unsuccessful'
  ) {
    return 'failed';
  }

  return 'unknown';
}

function normalizeDbVtuStatus(status: unknown): VtuTransactionRow['status'] {
  if (
    status === 'pending' ||
    status === 'processing' ||
    status === 'successful' ||
    status === 'failed'
  ) {
    return status;
  }

  console.warn(
    'Unexpected VTU transaction DB status; using processing fallback:',
    {
      status,
    }
  );
  return 'processing';
}

const NAIRA_FORMATTER_WHOLE = new Intl.NumberFormat('en-NG', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const NAIRA_FORMATTER_FRACTION = new Intl.NumberFormat('en-NG', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

function formatNaira(amount: number) {
  const formatter = Number.isInteger(amount)
    ? NAIRA_FORMATTER_WHOLE
    : NAIRA_FORMATTER_FRACTION;
  return `₦${formatter.format(amount)}`;
}

function getVtuProviderLabel(row: VtuTransactionRow) {
  return row.network_provider || row.biller_name || VTU_TYPE_LABELS[row.type];
}

function getStorefrontUtilityType(type: VtuTransactionRow['type']) {
  switch (type) {
    case 'airtime':
      return 'airtime';
    case 'data':
      return 'data';
    case 'electricity':
      return 'power';
    case 'cable_tv':
      return 'tv';
    case 'betting':
      return 'gaming';
    default:
      return assertNeverVtuType(type);
  }
}

function assertNeverVtuType(value: never): never {
  throw new Error(`Unhandled VTU transaction type: ${value}`);
}

function setMetadataValue(
  metadata: Record<string, unknown>,
  key: string,
  value: unknown
) {
  if (metadata[key] === value) {
    return false;
  }
  metadata[key] = value;
  return true;
}

/**
 * Refund a failed VTU vend's wallet debit back to the customer wallet so
 * the customer can retry from restored credit. Wallet-only: utilities
 * are paid exclusively from wallet balance (gateway and saved-card
 * utility routes return VTU_WALLET_ONLY without collecting), so there
 * is no card portion to refund — do not reintroduce split-payment
 * refund logic here.
 *
 * Gates:
 *  - row.customer_id must be set (no wallet to credit otherwise)
 *  - row.amount must be positive
 *  - row.source === 'checkout' — only checkout-sourced VTU rows move
 *    customer money (the wallet-only route debits the wallet before
 *    vending); 'direct' and 'storefront_modal' are blocked at the API
 *    layer before a row is ever created, and 'loyalty_reward' / 'gift'
 *    are funded by points / merchant, not the customer's wallet.
 *
 * Note: an earlier draft gated on metadata.paymentReference, but not
 * every collecting path stores that on vtu_transactions.metadata —
 * gating on it would skip refunds this gate must cover.
 *
 * Idempotent at the RPC layer via pg_advisory_xact_lock + a uniqueness
 * lookup on (source_type='vtu_transaction_refund', source_id, type='refund').
 * Also writes metadata.refundIssued / metadata.refundAmount for visibility.
 */
async function refundVtuToCustomerWallet({
  metadata,
  row,
  supabase,
  refundContext = 'kuda_failure',
  requireCollectionEvidence = false,
}: {
  metadata: Record<string, unknown>;
  row: VtuTransactionRow;
  supabase: SupabaseClient;
  /**
   * Existing-failed rows only (Codex R51 6rqH1I): the card-only
   * fallthrough refunds full row.amount for rows WITHOUT a
   * paymentSplit — a legacy shape that includes gateway-init and
   * declined-authorization rows which never collected. Fresh vend
   * failures leave this false (this pass's vend attempt proves
   * collection preceded it); rows arriving ALREADY failed demand
   * recorded evidence or the row is marked skipped, never credited.
   */
  requireCollectionEvidence?: boolean;
  /**
   * `kuda_failure` (default): the vend was actually attempted and the
   * upstream provider rejected it. If the wallet leg was already debited
   * (`metadata.walletDebited === true`), reverse it; refund the card
   * portion as fresh wallet credit.
   *
   * `wallet_race`: the strict-amount wallet RPC raised
   * `insufficient_wallet_balance` BEFORE the vend ran. The wallet was
   * never debited, so there is nothing to reverse. Only the card portion
   * needs refunding (and only if cardPortion > 0 — wallet-only flows
   * with no gateway charge produce no ledger row at all).
   */
  refundContext?: 'kuda_failure' | 'wallet_race';
}): Promise<{
  metadataChanged: boolean;
  refundIssued: boolean;
  refundedAmount: number;
}> {
  const totalAmount = Number(row.amount ?? 0);

  if (!row.customer_id || totalAmount <= 0) {
    return { metadataChanged: false, refundIssued: false, refundedAmount: 0 };
  }
  if (row.source !== 'checkout') {
    return { metadataChanged: false, refundIssued: false, refundedAmount: 0 };
  }
  if (metadata.refundIssued === true) {
    // Already refunded on a prior fulfillment pass.
    return {
      metadataChanged: false,
      refundIssued: true,
      refundedAmount: Number(metadata.refundAmount ?? totalAmount),
    };
  }

  const paymentSplit = readPaymentSplit(metadata);
  const walletWasDebited = metadata.walletDebited === true;

  // Dispatch by refund context. The branches were extracted into named
  // helpers so each can be reasoned about (and tested) in isolation. The
  // P1 invariant: a `kuda_failure` context with `paymentSplit` MUST also
  // have `walletDebited === true`. If it doesn't, the wallet leg was
  // never charged — falling through to the card-only branch would refund
  // `totalAmount` and over-credit by `paymentSplit.wallet`. Throw rather
  // than guess.
  if (refundContext === 'kuda_failure' && paymentSplit && walletWasDebited) {
    return await refundHybridKudaFailure({
      metadata,
      row,
      supabase,
      paymentSplit,
    });
  }
  if (refundContext === 'wallet_race' && paymentSplit) {
    return await refundHybridWalletRace({
      metadata,
      row,
      supabase,
      paymentSplit,
    });
  }
  if (refundContext === 'kuda_failure' && paymentSplit && !walletWasDebited) {
    // Logically equivalent to wallet-race (wallet never debited). The
    // post-fact replay path defaults `refundContext` to 'kuda_failure'
    // for any failed row, including rows whose original failure was a
    // wallet-race — so this branch is reached during normal recovery,
    // not just on invariant violations. Consult the ledger (the source
    // of truth) before deciding which path we're on:
    //   - refund row exists → wallet-race already compensated; sync
    //     metadata and return so the customer isn't stuck in a 500
    //     loop after a transient metadata-persist failure.
    //   - no refund row → genuine invariant violation (vend was
    //     attempted, wallet never debited, no compensation issued).
    //     Fail closed so the webhook retries with a clean slate.
    const existingRefund = await findExistingVtuRefundLedger({
      row,
      supabase,
    });
    if (existingRefund) {
      const metadataChanged = applyRefundMetadata(
        metadata,
        existingRefund.amount,
        'wallet_race'
      );
      return {
        metadataChanged,
        refundIssued: true,
        refundedAmount: existingRefund.amount,
      };
    }
    throwVtuPersistenceError(
      `Refund dispatch invariant violated for ${row.id}: paymentSplit present, walletDebited=false, refundContext=kuda_failure, no ledger refund row`
    );
  }
  // Card-only path (no paymentSplit — legacy shape; current
  // checkout rows always persist a split at prepare time): refund the
  // full row.amount ONLY with collection evidence when the caller
  // requires it (see vtu-fulfillment-recovery for the why).
  if (
    requireCollectionEvidence &&
    (await shouldSkipRefundWithoutCollectionEvidence({
      metadata,
      row,
      supabase,
    }))
  ) {
    const metadataChanged = setMetadataValue(
      metadata,
      VTU_REFUND_SKIPPED_KEY,
      VTU_REFUND_SKIPPED_NO_COLLECTION
    );
    return { metadataChanged, refundIssued: false, refundedAmount: 0 };
  }
  return await refundCardOnly({ metadata, row, supabase, totalAmount });
}

interface RefundBranchInput {
  metadata: Record<string, unknown>;
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}

interface RefundBranchResult {
  metadataChanged: boolean;
  refundIssued: boolean;
  refundedAmount: number;
}

function applyRefundMetadata(
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

async function refundHybridKudaFailure({
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
  const metadataChanged = applyRefundMetadata(
    metadata,
    paymentSplit.card,
    'hybrid_vend_failure'
  );
  return {
    metadataChanged,
    refundIssued: true,
    refundedAmount: paymentSplit.card,
  };
}

async function refundHybridWalletRace({
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

async function refundCardOnly({
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

const PURCHASE_RESULT_UPDATE_MAX_ATTEMPTS = 3;
const PURCHASE_RESULT_UPDATE_BACKOFF_MS = [100, 250] as const;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }

  return String(error);
}

function isMonnifyTransientVendError(error: unknown) {
  return error instanceof Error && error.name === 'MonnifyTransientVendError';
}

function waitForRetryBackoff(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function updateVtuPurchaseResultWithRetry({
  expectedStatus,
  payload,
  row,
  supabase,
}: {
  payload: {
    error_message: string | null;
    metadata: Record<string, unknown>;
    status: 'pending' | 'processing' | 'successful' | 'failed';
    transaction_id: string | null;
  };
  expectedStatus?: VtuTransactionRow['status'];
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}) {
  let lastError: unknown = null;

  for (
    let attempt = 1;
    attempt <= PURCHASE_RESULT_UPDATE_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const updateQuery = supabase
      .from('vtu_transactions')
      .update(payload)
      .eq('id', row.id);

    const { data, error } = expectedStatus
      ? await updateQuery
          .eq('status', expectedStatus)
          .select('id')
          .maybeSingle()
      : await updateQuery;

    if (!error) {
      if (expectedStatus && !data) {
        return new VtuConcurrentUpdateError(
          `VTU transaction ${row.id} was no longer ${expectedStatus}`
        );
      }
      return null;
    }

    lastError = error;
    if (attempt >= PURCHASE_RESULT_UPDATE_MAX_ATTEMPTS) {
      break;
    }

    const delayMs =
      PURCHASE_RESULT_UPDATE_BACKOFF_MS[
        Math.min(attempt - 1, PURCHASE_RESULT_UPDATE_BACKOFF_MS.length - 1)
      ];
    console.warn(
      'Retrying VTU purchase result persistence after failed update:',
      {
        attempt,
        delayMs,
        error: getErrorMessage(error),
        maxAttempts: PURCHASE_RESULT_UPDATE_MAX_ATTEMPTS,
        status: payload.status,
        transactionId: row.id,
        transactionReference: payload.transaction_id,
      }
    );
    await waitForRetryBackoff(delayMs);
  }

  return lastError;
}

async function findExistingCustomerCashback({
  row,
  supabase,
}: {
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}) {
  if (!row.customer_id) {
    return null;
  }

  const { data, error } = await supabase
    .from('customer_wallet_transactions')
    .select('balance_after')
    .eq('customer_id', row.customer_id)
    .eq('merchant_id', row.merchant_id)
    .eq('source_type', 'vtu_transaction')
    .eq('source_id', row.id)
    .eq('type', 'cashback')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Failed to check existing VTU cashback ledger:', {
      error: error.message,
      transactionId: row.id,
    });
    throwVtuPersistenceError('Failed to check existing VTU cashback ledger');
  }

  return data;
}

async function findExistingVtuRefundLedger({
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

async function findExistingMerchantCommission({
  row,
  supabase,
}: {
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}) {
  const { data, error } = await supabase
    .from('wallet_transactions')
    .select('id')
    .eq('merchant_id', row.merchant_id)
    .eq('source_type', 'vtu_transaction')
    .eq('source_id', row.id)
    .eq('type', 'credit')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Failed to check existing VTU merchant commission:', {
      error: error.message,
      transactionId: row.id,
    });
    throwVtuPersistenceError(
      'Failed to check existing VTU merchant commission'
    );
  }

  return data;
}

async function settleVtuWalletCredits({
  metadata,
  row,
  supabase,
}: {
  metadata: Record<string, unknown>;
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}) {
  const merchantCommission = Number(row.merchant_commission ?? 0);
  const cashbackAmount = Number(row.customer_cashback ?? 0);
  let metadataChanged = false;
  let merchantWalletCredited = metadata.merchantWalletCredited === true;
  let customerWalletCredited = metadata.customerWalletCredited === true;
  let customerNewBalance = coerceNumber(metadata.customerNewBalance);

  // Ledger lookups are the idempotency guard when successful fulfillment is re-entered.
  if (merchantCommission > 0 && !merchantWalletCredited) {
    const existingCommission = await findExistingMerchantCommission({
      row,
      supabase,
    });

    if (existingCommission) {
      merchantWalletCredited = true;
    } else {
      const { error } = await supabase.rpc('credit_merchant_wallet', {
        p_merchant_id: row.merchant_id,
        p_amount: merchantCommission,
        p_source_type: 'vtu_transaction',
        p_source_id: row.id,
        p_description: `VTU Commission - ${VTU_TYPE_LABELS[row.type]} ${getVtuProviderLabel(row)} ₦${row.amount}`,
      });
      if (error) {
        console.error('Failed to credit VTU merchant wallet:', {
          amount: row.amount,
          error: error.message,
          merchantCommission,
          merchantId: row.merchant_id,
          provider: getVtuProviderLabel(row),
          rpc: 'credit_merchant_wallet',
          transactionId: row.id,
          type: row.type,
        });
      }
      merchantWalletCredited = !error;
    }

    metadataChanged =
      setMetadataValue(
        metadata,
        'merchantWalletCredited',
        merchantWalletCredited
      ) || metadataChanged;
  }

  if (cashbackAmount > 0 && row.customer_id && !customerWalletCredited) {
    const existingCashback = await findExistingCustomerCashback({
      row,
      supabase,
    });

    if (existingCashback) {
      customerWalletCredited = true;
      customerNewBalance = coerceNumber(existingCashback.balance_after);
    } else {
      const { data, error } = await supabase.rpc('credit_customer_wallet', {
        p_customer_id: row.customer_id,
        p_merchant_id: row.merchant_id,
        p_amount: cashbackAmount,
        p_source_type: 'vtu_transaction',
        p_source_id: row.id,
        p_description: `Cashback - ${VTU_TYPE_LABELS[row.type]} ${getVtuProviderLabel(row)} ₦${row.amount}`,
      });

      if (!error) {
        customerWalletCredited = true;
        const nextBalance = getCreditWalletNewBalance(data);
        customerNewBalance = coerceNumber(nextBalance);
      } else {
        console.error('Failed to credit VTU customer wallet:', {
          cashbackAmount,
          customerId: row.customer_id,
          error: error.message,
          merchantId: row.merchant_id,
          rpc: 'credit_customer_wallet',
          transactionId: row.id,
        });
      }
    }

    metadataChanged =
      setMetadataValue(
        metadata,
        'customerWalletCredited',
        customerWalletCredited
      ) || metadataChanged;
    metadataChanged =
      setMetadataValue(metadata, 'customerNewBalance', customerNewBalance) ||
      metadataChanged;
  }

  return {
    customerNewBalance,
    customerWalletCredited,
    merchantWalletCredited,
    metadataChanged,
  };
}

async function claimCustomerNotificationAttempt({
  metadata,
  row,
  supabase,
}: {
  metadata: Record<string, unknown>;
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}) {
  if (metadata.customerNotificationAttempted === true) {
    return false;
  }

  const { data, error } = await supabase.rpc(
    'claim_vtu_customer_notification_attempt',
    {
      p_transaction_id: row.id,
    }
  );

  if (error) {
    console.error('Failed to claim VTU customer notification attempt:', {
      error: error.message,
      transactionId: row.id,
    });
    return false;
  }

  const claimedMetadata = readMetadataRecord(data);
  if (Object.keys(claimedMetadata).length === 0) {
    return false;
  }

  setMetadataValue(metadata, 'customerNotificationAttempted', true);
  return true;
}

async function claimCustomerEmailNotificationAttempt({
  metadata,
  row,
  state,
  supabase,
}: {
  metadata: Record<string, unknown>;
  row: VtuTransactionRow;
  state: CustomerEmailNotificationState;
  supabase: SupabaseClient;
}) {
  if (
    (metadata[state.attemptedKey] === true &&
      !isCustomerEmailClaimLeaseExpired({ metadata, state })) ||
    isCustomerEmailNotificationSent(metadata, state)
  ) {
    return null;
  }

  const priorAttempted = metadata[state.attemptedKey];
  const priorAttemptedAt = metadata[getCustomerEmailAttemptedAtKey(state)];

  const { data, error } = await supabase.rpc(
    'claim_vtu_customer_email_notification_attempt',
    {
      p_attempt_key: state.attemptedKey,
      p_sent_key: state.sentKey,
      p_transaction_id: row.id,
    }
  );

  if (error) {
    console.error('Failed to claim VTU customer email notification attempt:', {
      error: error.message,
      transactionId: row.id,
    });
    return null;
  }

  const claimedMetadata = readMetadataRecord(data);
  if (Object.keys(claimedMetadata).length === 0) {
    return null;
  }

  for (const [key, value] of Object.entries(claimedMetadata)) {
    setMetadataValue(metadata, key, value);
  }
  const generation = getCustomerEmailClaimLeaseGeneration({
    metadata: claimedMetadata,
    state,
  });
  if (!generation) {
    return null;
  }
  return { generation, priorAttempted, priorAttemptedAt };
}

function revertStaleEmailClaimLease({
  lease,
  metadata,
  state,
}: {
  lease: CustomerEmailClaimLease;
  metadata: Record<string, unknown>;
  state: CustomerEmailNotificationState;
}) {
  // Our clear lost (reclaimed row or RPC error): restore the pre-claim
  // lease keys so the settlement merge leaves the owner's lease
  // untouched instead of persisting our stale generation.
  const attemptedAtKey = getCustomerEmailAttemptedAtKey(state);
  if (lease.priorAttempted === undefined) {
    delete metadata[state.attemptedKey];
  } else {
    metadata[state.attemptedKey] = lease.priorAttempted;
  }
  if (lease.priorAttemptedAt === undefined) {
    delete metadata[attemptedAtKey];
  } else {
    metadata[attemptedAtKey] = lease.priorAttemptedAt;
  }
}

async function clearCustomerEmailNotificationAttempt({
  lease,
  metadata,
  row,
  state,
  supabase,
}: {
  lease: CustomerEmailClaimLease;
  metadata: Record<string, unknown>;
  row: VtuTransactionRow;
  state: CustomerEmailNotificationState;
  supabase: SupabaseClient;
}) {
  const { data, error } = await supabase.rpc(
    'clear_vtu_customer_email_notification_attempt',
    {
      p_attempt_at: lease.generation,
      p_attempt_key: state.attemptedKey,
      p_sent_key: state.sentKey,
      p_transaction_id: row.id,
    }
  );

  if (error) {
    console.error('Failed to clear VTU customer email notification attempt:', {
      error: error.message,
      transactionId: row.id,
    });
    revertStaleEmailClaimLease({ lease, metadata, state });
    return false;
  }

  const clearedMetadata = readMetadataRecord(data);
  if (Object.keys(clearedMetadata).length === 0) {
    revertStaleEmailClaimLease({ lease, metadata, state });
    return false;
  }

  for (const [key, value] of Object.entries(clearedMetadata)) {
    setMetadataValue(metadata, key, value);
  }
  return true;
}

async function notifyVtuCustomerSuccess({
  cashbackAmount,
  customerWalletCredited,
  metadata,
  row,
  supabase,
}: {
  cashbackAmount: number;
  customerWalletCredited: boolean;
  metadata: Record<string, unknown>;
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}) {
  if (!row.customer_id) {
    return { metadataChanged: false };
  }

  const { data: customer, error } = await supabase
    .from('customers')
    .select('user_id, email, first_name, last_name')
    .eq('id', row.customer_id)
    .maybeSingle();

  if (error || (!customer?.user_id && !customer?.email)) {
    if (error) {
      console.error('Failed to resolve VTU customer notification user:', {
        error: error.message,
        transactionId: row.id,
      });
    }
    return { metadataChanged: false };
  }

  const { data: merchant, error: merchantError } = await supabase
    .from('merchants')
    .select('business_name, slug, support_email')
    .eq('id', row.merchant_id)
    .single();

  if (merchantError) {
    console.error('Failed to resolve VTU merchant notification context:', {
      error: merchantError.message,
      merchantId: row.merchant_id,
      transactionId: row.id,
    });
  }

  const shouldAttemptPush =
    Boolean(customer.user_id) &&
    metadata.customerNotificationAttempted !== true;
  const label = VTU_TYPE_LABELS[row.type];
  const provider = getVtuProviderLabel(row);
  const voucherPin = getVoucherPinFromMetadata(metadata);
  const isTokenReady =
    canResolveBillVoucherPin(row.type) && Boolean(voucherPin);
  const emailNotificationState = getCustomerEmailNotificationState({
    isTokenReady,
    type: row.type,
  });
  const shouldAttemptEmail =
    Boolean(customer.email) &&
    !isCustomerEmailNotificationSent(metadata, emailNotificationState);

  if (!shouldAttemptPush && !shouldAttemptEmail) {
    return { metadataChanged: false };
  }

  const claimedNotification = shouldAttemptPush
    ? await claimCustomerNotificationAttempt({
        metadata,
        row,
        supabase,
      })
    : false;
  const claimedEmailNotification = shouldAttemptEmail
    ? await claimCustomerEmailNotificationAttempt({
        metadata,
        row,
        state: emailNotificationState,
        supabase,
      })
    : null;
  const baseBody = `Your ${provider} ${label.toLowerCase()} purchase of ${formatNaira(Number(row.amount) || 0)} was successful.`;
  const cashbackBody =
    cashbackAmount > 0 && customerWalletCredited
      ? ` ${formatNaira(cashbackAmount)} cashback was credited to your wallet.`
      : '';
  const title = isTokenReady ? 'Token ready' : `${label} purchase successful`;
  const body = isTokenReady
    ? `Your ${provider} ${label.toLowerCase()} token is ready. Tap to view it.${cashbackBody}`
    : `${baseBody}${cashbackBody}`;
  const payload = isTokenReady
    ? {
        amount: Number(row.amount) || 0,
        cashbackAmount,
        reference: row.request_reference,
        transactionId: row.id,
        type: 'vtu_token_ready',
        utilityType: getStorefrontUtilityType(row.type),
        vtuType: row.type,
      }
    : {
        amount: Number(row.amount) || 0,
        cashbackAmount,
        reference: row.request_reference,
        transactionId: row.id,
        type: 'vtu_purchase_success',
        vtuType: row.type,
      };

  let metadataChanged = Boolean(
    claimedNotification || claimedEmailNotification
  );

  // 1. Send push notification if user_id exists
  if (shouldAttemptPush && customer.user_id && claimedNotification) {
    try {
      const result = await notifyCustomer(
        customer.user_id,
        title,
        body,
        payload,
        'orders'
      );

      metadataChanged =
        setMetadataValue(
          metadata,
          'customerNotificationSent',
          result.sent > 0
        ) || metadataChanged;
    } catch (error) {
      console.error('Failed to send VTU success notification:', {
        error: error instanceof Error ? error.message : String(error),
        transactionId: row.id,
      });
      metadataChanged =
        setMetadataValue(metadata, 'customerNotificationSent', false) ||
        metadataChanged;
    }
  }

  // 2. Send email receipt to customer if email exists
  if (shouldAttemptEmail && customer.email && claimedEmailNotification) {
    try {
      const { sendEmail } = await import('@/lib/zeptomail');
      const { generateVtuTokenReceiptEmail, generateVtuTokenReceiptText } =
        await import('@/lib/email-templates');

      const merchantName = merchant?.business_name || 'Baci Merchant';
      const rootDomain = getRootDomain() || 'usebaci.com';
      const merchantUrl = merchant?.slug
        ? `https://${merchant.slug}.${rootDomain}`
        : `https://${rootDomain}`;
      const customerName = customer.first_name
        ? `${customer.first_name} ${customer.last_name || ''}`.trim()
        : 'Customer';
      // Meter/customer address persisted at checkout (electricity), so the
      // emailed receipt matches the in-app/history receipt.
      const receiptAddress =
        typeof metadata.address === 'string' ? metadata.address : null;

      const emailHtml = generateVtuTokenReceiptEmail({
        transactionId: row.id,
        reference: row.request_reference,
        customerName,
        amount: Number(row.amount) || 0,
        type: row.type,
        providerLabel: provider,
        customerIdentifier: row.customer_identifier ?? null,
        address: receiptAddress,
        voucherPin: voucherPin ?? null,
        phone_number: row.phone_number ?? null,
        merchantName,
        merchantUrl,
        supportEmail: merchant?.support_email ?? undefined,
      });

      const emailText = generateVtuTokenReceiptText({
        transactionId: row.id,
        reference: row.request_reference,
        customerName,
        amount: Number(row.amount) || 0,
        type: row.type,
        providerLabel: provider,
        customerIdentifier: row.customer_identifier ?? null,
        address: receiptAddress,
        voucherPin: voucherPin ?? null,
        phone_number: row.phone_number ?? null,
        merchantName,
        merchantUrl,
        supportEmail: merchant?.support_email ?? undefined,
      });

      const emailResult = await sendEmail({
        to: customer.email,
        toName: customerName,
        subject: isTokenReady
          ? `Your Prepaid Token is Ready - ${merchantName}`
          : `Receipt for ${label} Purchase - ${merchantName}`,
        htmlContent: emailHtml,
        textContent: emailText,
        emailType: 'orders',
        fromName: merchantName,
        auditContext: {
          merchantId: row.merchant_id,
          customerId: row.customer_id,
          metadata: {
            vtuTransactionId: row.id,
            vtuType: row.type,
          },
        },
      });

      metadataChanged =
        setCustomerEmailNotificationResult({
          metadata,
          sent: emailResult.success,
          state: emailNotificationState,
        }) || metadataChanged;
      if (!emailResult.success && claimedEmailNotification) {
        metadataChanged =
          (await clearCustomerEmailNotificationAttempt({
            lease: claimedEmailNotification,
            metadata,
            row,
            state: emailNotificationState,
            supabase,
          })) || metadataChanged;
      }
    } catch (emailError) {
      console.error('Failed to send VTU customer email receipt:', {
        error:
          emailError instanceof Error ? emailError.message : String(emailError),
        transactionId: row.id,
      });
      metadataChanged =
        setCustomerEmailNotificationResult({
          metadata,
          sent: false,
          state: emailNotificationState,
        }) || metadataChanged;
      if (claimedEmailNotification) {
        metadataChanged =
          (await clearCustomerEmailNotificationAttempt({
            lease: claimedEmailNotification,
            metadata,
            row,
            state: emailNotificationState,
            supabase,
          })) || metadataChanged;
      }
    }
  }

  return { metadataChanged };
}

function getProviderCheckTransactionStatus(
  metadata: Record<string, unknown> | null | undefined
) {
  const provider = metadata?.provider;
  if (provider === 'monnify') {
    // Monnify requery resolves ONLY by its own vendReference (persisted at vend
    // time), NOT by transactionReference. Never fall back to the passed
    // responseRef (transaction_id): requerying with a non-vendReference returns
    // a business "not found", which normalizes to `failed` and would wrongly
    // fail/refund a pending-or-delivered vend. Legacy rows that predate
    // vendReference persistence stay in processing instead.
    const monnifyVendReference =
      typeof metadata?.monnifyVendReference === 'string'
        ? metadata.monnifyVendReference
        : undefined;
    return async (_responseRef?: string, _requestRef?: string) => {
      if (!monnifyVendReference) {
        return {
          status: 'PENDING',
          message:
            'No Monnify vend reference to requery; leaving in processing state',
        };
      }
      return await monnifyCheckTransactionStatus(monnifyVendReference);
    };
  }
  return kudaCheckTransactionStatus;
}

export async function backfillVtuVoucherPin({
  billResponseReference,
  billRequestRef,
  metadata,
  supabase,
  transactionId,
}: {
  billRequestRef?: string | null;
  billResponseReference?: string | null;
  metadata: Record<string, unknown> | null;
  supabase: SupabaseClient;
  transactionId: string;
}) {
  const existingVoucherPin = getVoucherPinFromMetadata(metadata);
  if (existingVoucherPin) {
    return { voucherPin: existingVoucherPin, units: undefined };
  }

  // Monnify requery resolves by a persisted vendReference even when this row has
  // no transaction_id yet, so allow the requery to run when it is present.
  const monnifyVendReference =
    typeof metadata?.monnifyVendReference === 'string'
      ? metadata.monnifyVendReference
      : undefined;
  if (!billResponseReference && !billRequestRef && !monnifyVendReference) {
    return { voucherPin: undefined, units: undefined };
  }

  try {
    const checkStatus = getProviderCheckTransactionStatus(metadata);
    const status = await checkStatus(
      billResponseReference ?? undefined,
      billRequestRef ?? undefined
    );
    const voucherPin = status ? normalizeVoucherPin(status.pin) : undefined;
    if (!voucherPin) {
      return { voucherPin: undefined, units: undefined };
    }

    const { error } = await supabase.rpc('set_vtu_transaction_voucher_pin', {
      p_transaction_id: transactionId,
      p_voucher_pin: voucherPin,
    });

    if (error) {
      console.error('Failed to persist VTU voucher pin:', {
        error: error.message,
        transactionId,
      });
    }

    // Return the delivered units (Monnify requery) so the CALLER persists them
    // in the same metadata write it already performs — writing them here would
    // be clobbered by the caller's subsequent `updatedMetadata` write.
    return { voucherPin, units: status?.units?.trim() || undefined };
  } catch (error) {
    console.error('Failed to backfill VTU voucher pin from Kuda:', error);
    return { voucherPin: undefined, units: undefined };
  }
}

async function resolveSuccessfulVtuTransaction({
  reconciledVoucherPin,
  reconciledUnits,
  row,
  supabase,
}: {
  reconciledVoucherPin?: string;
  reconciledUnits?: string;
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}): Promise<FulfilledVtuResult> {
  const metadata = { ...(row.metadata ?? {}) };
  // Deep baseline for the CAS merge below: sub-steps mutate
  // `metadata` in place, and nested objects are shared by spread —
  // diffing needs an unaliased snapshot.
  const preSettlementMetadata = JSON.parse(JSON.stringify(metadata)) as Record<
    string,
    unknown
  >;
  let metadataChanged = false;
  const cashbackAmount = Number(row.customer_cashback ?? 0);
  let voucherPin = normalizeVoucherPin(reconciledVoucherPin);
  // Units reconciled alongside the pin (e.g. from a requery during processing
  // reconciliation) — kept so reconciled prepaid vends store units too.
  let resolvedUnits = reconciledUnits?.trim() || undefined;
  if (!voucherPin) {
    if (canResolveBillVoucherPin(row.type)) {
      const backfilled = await backfillVtuVoucherPin({
        billRequestRef: row.request_reference,
        billResponseReference: row.transaction_id,
        metadata: row.metadata,
        supabase,
        transactionId: row.id,
      });
      voucherPin = backfilled.voucherPin;
      resolvedUnits = resolvedUnits ?? backfilled.units;
    } else {
      voucherPin = getVoucherPinFromMetadata(row.metadata);
    }
  }
  if (voucherPin) {
    metadataChanged =
      setMetadataValue(metadata, 'voucherPin', voucherPin) || metadataChanged;
  }
  if (resolvedUnits) {
    metadataChanged =
      setMetadataValue(metadata, 'units', resolvedUnits) || metadataChanged;
  }
  const walletSettlement = await settleVtuWalletCredits({
    metadata,
    row,
    supabase,
  });
  metadataChanged = walletSettlement.metadataChanged || metadataChanged;
  const loyaltyPoints = await awardVtuAirtimeLoyaltyPoints({
    metadata,
    row,
    supabase,
  });
  metadataChanged = loyaltyPoints.metadataChanged || metadataChanged;
  const notificationSettlement = await notifyVtuCustomerSuccess({
    cashbackAmount,
    customerWalletCredited: walletSettlement.customerWalletCredited,
    metadata,
    row,
    supabase,
  });
  metadataChanged = notificationSettlement.metadataChanged || metadataChanged;

  if (metadataChanged) {
    // CAS-merged (Codex R82 P2): a concurrent replay settling the
    // same row must not lose its keys to this write, nor vice versa.
    await mergeVtuSettlementMetadata({
      baselineMetadata: preSettlementMetadata,
      mutatedMetadata: metadata,
      rowId: row.id,
      supabase,
    });
  }

  return {
    amount: Number(row.amount) || 0,
    cashback:
      cashbackAmount > 0
        ? {
            amount: cashbackAmount,
            credited: walletSettlement.customerWalletCredited,
            newBalance: walletSettlement.customerNewBalance,
          }
        : undefined,
    customerIdentifier: row.customer_identifier ?? undefined,
    ...(loyaltyPoints.credited
      ? {
          loyaltyPoints: {
            credited: loyaltyPoints.credited,
            earned: loyaltyPoints.earned,
            ...(loyaltyPoints.newBalance !== undefined
              ? { newBalance: loyaltyPoints.newBalance }
              : {}),
          },
        }
      : {}),
    reference: row.request_reference,
    status: 'successful',
    ...(voucherPin && { voucherPin }),
  };
}

async function reconcileFailedVtuRetry({
  row,
  supabase,
}: {
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}): Promise<
  { action: 'retry' } | { action: 'return'; result: FulfilledVtuResult }
> {
  try {
    const checkStatus = getProviderCheckTransactionStatus(row.metadata);
    const providerStatus = await checkStatus(
      row.transaction_id ?? undefined,
      row.request_reference || undefined
    );
    const reconciledStatus = normalizeProviderStatus(providerStatus.status);

    if (reconciledStatus === 'failed') {
      return { action: 'retry' };
    }

    if (reconciledStatus === 'successful') {
      const { data: reconciled, error } = await supabase
        .from('vtu_transactions')
        .update({ error_message: null, status: 'successful' })
        .eq('id', row.id)
        .eq('status', 'failed')
        .select('id')
        .maybeSingle();

      if (error) {
        throw new VtuPersistenceError(
          `Failed to reconcile VTU transaction ${row.id}: ${error.message}`
        );
      }

      if (!reconciled) {
        const { data: current } = await supabase
          .from('vtu_transactions')
          .select('error_message, status')
          .eq('id', row.id)
          .single();
        const currentStatus = normalizeDbVtuStatus(current?.status);
        if (currentStatus === 'successful') {
          return {
            action: 'return',
            result: await resolveSuccessfulVtuTransaction({
              reconciledVoucherPin: providerStatus.pin,
              row: { ...row, error_message: null, status: 'successful' },
              supabase,
            }),
          };
        }

        if (currentStatus === 'failed') {
          return {
            action: 'return',
            result: {
              amount: Number(row.amount) || 0,
              error:
                typeof current?.error_message === 'string'
                  ? current.error_message
                  : row.error_message || 'Purchase failed',
              reference: row.request_reference,
              status: 'failed',
            },
          };
        }

        return {
          action: 'return',
          result: {
            amount: Number(row.amount) || 0,
            reference: row.request_reference,
            status: 'processing',
          },
        };
      }

      return {
        action: 'return',
        result: await resolveSuccessfulVtuTransaction({
          reconciledVoucherPin: providerStatus.pin,
          reconciledUnits: providerStatus.units,
          row: { ...row, error_message: null, status: 'successful' },
          supabase,
        }),
      };
    }

    return {
      action: 'return',
      result: {
        amount: Number(row.amount) || 0,
        error:
          reconciledStatus === 'processing'
            ? 'Original utility purchase is still processing with the provider'
            : 'Unable to reconcile failed utility purchase with the provider',
        reference: row.request_reference,
        status: 'failed',
      },
    };
  } catch (error) {
    console.error('Failed to reconcile failed VTU transaction before retry:', {
      error: error instanceof Error ? error.message : String(error),
      transactionId: row.id,
    });
    return {
      action: 'return',
      result: {
        amount: Number(row.amount) || 0,
        error: 'Unable to reconcile failed utility purchase with the provider',
        reference: row.request_reference,
        status: 'failed',
      },
    };
  }
}

function readMetadataRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

async function readCurrentVtuTransactionRow({
  row,
  supabase,
}: {
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}): Promise<VtuTransactionRow> {
  const { data, error } = await supabase
    .from('vtu_transactions')
    .select(
      'customer_cashback, error_message, merchant_commission, metadata, status, transaction_id'
    )
    .eq('id', row.id)
    .single();

  if (error || !data) {
    throw new VtuPersistenceError(
      `Failed to read current VTU transaction ${row.id}: ${error?.message ?? 'not found'}`
    );
  }

  const snapshot = data as {
    customer_cashback?: unknown;
    error_message?: unknown;
    merchant_commission?: unknown;
    metadata?: unknown;
    status?: unknown;
    transaction_id?: unknown;
  };
  const refreshedMoney = refreshSnapshotMoneyColumns(snapshot, row);

  return {
    ...row,
    customer_cashback: refreshedMoney.customer_cashback,
    error_message:
      typeof snapshot.error_message === 'string'
        ? snapshot.error_message
        : null,
    merchant_commission: refreshedMoney.merchant_commission,
    metadata: readMetadataRecord(snapshot.metadata),
    status: normalizeDbVtuStatus(snapshot.status),
    transaction_id:
      typeof snapshot.transaction_id === 'string'
        ? snapshot.transaction_id
        : row.transaction_id,
  };
}

async function resolveCurrentVtuTransactionState({
  reconciledVoucherPin,
  reconciledUnits,
  row,
  supabase,
}: {
  reconciledVoucherPin?: string;
  reconciledUnits?: string;
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}): Promise<FulfilledVtuResult> {
  const currentRow = await readCurrentVtuTransactionRow({ row, supabase });

  if (currentRow.status === 'successful') {
    return resolveSuccessfulVtuTransaction({
      reconciledVoucherPin,
      reconciledUnits,
      row: currentRow,
      supabase,
    });
  }

  if (currentRow.status === 'failed') {
    // Concurrent return (replay/cron overlap): confirm the refund
    // inline (terminal response + cron-excluded rows). Extracted per
    // the Boy Scout Rule; the issuer is injected (module-private).
    return await resolveConcurrentFailedVtuTransaction({
      issueRefund: (metadata) =>
        refundVtuToCustomerWallet({ metadata, row: currentRow, supabase }),
      row: currentRow,
      supabase,
    });
  }

  return {
    amount: Number(currentRow.amount) || 0,
    reference: currentRow.request_reference,
    status: 'processing',
  };
}

async function claimProcessingVtuReconciliation({
  row,
  supabase,
}: {
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}): Promise<VtuTransactionRow | null> {
  const providerTransactionId = getProviderTransactionId(row);
  const providerResponseMessage = getProcessingProviderResponseMessage(row);
  if (!providerTransactionId && !providerResponseMessage) {
    return null;
  }

  const metadata = {
    ...(row.metadata ?? {}),
    processingReconciliationClaimedAt: new Date().toISOString(),
    processingReconciliationReference: row.request_reference,
    ...(providerTransactionId && {
      processingReconciliationTransactionId: providerTransactionId,
    }),
  };
  const claimPayload: {
    metadata: Record<string, unknown>;
    status: 'processing';
    transaction_id?: string;
  } = {
    metadata,
    status: 'processing',
    ...(providerTransactionId && { transaction_id: providerTransactionId }),
  };
  let claimQuery = supabase
    .from('vtu_transactions')
    .update(claimPayload)
    .eq('id', row.id)
    .eq('status', 'processing');

  claimQuery = providerTransactionId
    ? claimQuery.eq('transaction_id', providerTransactionId)
    : claimQuery
        .is('transaction_id', null)
        .eq('error_message', providerResponseMessage);

  const { data, error } = await claimQuery.select('id').maybeSingle();

  if (error) {
    throw new VtuPersistenceError(
      `Failed to claim VTU processing reconciliation for ${row.id}: ${error.message}`
    );
  }

  return data
    ? { ...row, metadata, transaction_id: providerTransactionId }
    : null;
}

async function reconcileProcessingVtuTransaction({
  row,
  supabase,
}: {
  row: VtuTransactionRow;
  supabase: SupabaseClient;
}): Promise<FulfilledVtuResult> {
  try {
    const checkStatus = getProviderCheckTransactionStatus(row.metadata);
    const providerStatus = await checkStatus(
      row.transaction_id ?? undefined,
      row.request_reference || undefined
    );
    const reconciledStatus = normalizeProviderStatus(providerStatus.status);
    const currentRow = await readCurrentVtuTransactionRow({ row, supabase });
    if (currentRow.status !== 'processing') {
      return resolveCurrentVtuTransactionState({
        reconciledVoucherPin: providerStatus.pin,
        reconciledUnits: providerStatus.units,
        row: currentRow,
        supabase,
      });
    }

    if (reconciledStatus === 'successful') {
      const successMetadata = { ...(currentRow.metadata ?? {}) };
      const voucherPin = normalizeVoucherPin(providerStatus.pin);
      if (voucherPin) {
        successMetadata.voucherPin = voucherPin;
      }
      const reconciledUnits = providerStatus.units?.trim() || undefined;
      if (reconciledUnits) {
        successMetadata.units = reconciledUnits;
      }
      // Covers flagged AND claimed fallback rows — both settle
      // through this branch.
      const fallbackCreditCorrection = applyKudaFallbackCreditCorrection({
        metadata: successMetadata,
        row: currentRow,
      });
      const successPersistError = await updateVtuPurchaseResultWithRetry({
        payload: {
          ...(fallbackCreditCorrection && {
            customer_cashback: fallbackCreditCorrection.customerCashback,
            merchant_commission: fallbackCreditCorrection.merchantCommission,
            platform_commission: fallbackCreditCorrection.platformCommission,
          }),
          error_message: null,
          metadata: successMetadata,
          status: 'successful',
          transaction_id: currentRow.transaction_id,
        },
        expectedStatus: 'processing',
        row: currentRow,
        supabase,
      });
      if (isVtuConcurrentUpdateError(successPersistError)) {
        return resolveCurrentVtuTransactionState({
          reconciledVoucherPin: voucherPin,
          reconciledUnits,
          row: currentRow,
          supabase,
        });
      }
      if (successPersistError) {
        throw new VtuPersistenceError(
          `Failed to persist reconciled VTU success for ${currentRow.id}: ${getErrorMessage(successPersistError)}`
        );
      }
      return resolveSuccessfulVtuTransaction({
        reconciledVoucherPin: voucherPin,
        reconciledUnits,
        row: {
          ...currentRow,
          error_message: null,
          metadata: successMetadata,
          status: 'successful',
        },
        supabase,
      });
    }

    if (reconciledStatus === 'failed') {
      const failedMetadata = { ...(currentRow.metadata ?? {}) };
      // Provider-authored text (below): drop any inherited safe flag
      // for the same reason as the fresh path.
      delete failedMetadata[VTU_CUSTOMER_SAFE_ERROR_MESSAGE_KEY];
      const failedMessage =
        providerStatus.message || 'Utility purchase failed with provider';
      const failedPersistError = await updateVtuPurchaseResultWithRetry({
        payload: {
          error_message: failedMessage,
          metadata: failedMetadata,
          status: 'failed',
          transaction_id: currentRow.transaction_id,
        },
        expectedStatus: 'processing',
        row: currentRow,
        supabase,
      });
      if (isVtuConcurrentUpdateError(failedPersistError)) {
        return resolveCurrentVtuTransactionState({
          row: currentRow,
          supabase,
        });
      }
      if (failedPersistError) {
        throw new VtuPersistenceError(
          `Failed to persist reconciled VTU failure for ${currentRow.id}: ${getErrorMessage(failedPersistError)}`
        );
      }
      const refund = await refundVtuToCustomerWallet({
        metadata: failedMetadata,
        row: currentRow,
        supabase,
      });
      if (refund.metadataChanged) {
        const { error: refundMetadataUpdateError } = await supabase
          .from('vtu_transactions')
          .update({ metadata: failedMetadata })
          .eq('id', currentRow.id)
          .eq('status', 'failed');
        if (refundMetadataUpdateError) {
          throw new VtuPersistenceError(
            `Failed to persist reconciled VTU refund metadata for ${currentRow.id}: ${refundMetadataUpdateError.message}`
          );
        }
      }
      throwIfVtuRefundUnconfirmed({
        row: currentRow,
        refundIssued: refund.refundIssued,
        refundedAmount: refund.refundedAmount,
        failedMessage,
        failedMetadata: getSafeMetadataDiagnostics(failedMetadata),
        message: `Unable to confirm VTU refund before finalizing provider failure for ${currentRow.id}`,
      });
      // As above: the provider requery message stays in
      // error_message (persisted raw for support); the response gets
      // the fixed customer-safe message.
      console.error('Reconciled VTU purchase failed with provider:', {
        provider: currentRow.network_provider,
        transactionId: currentRow.id,
      });
      return {
        amount: Number(currentRow.amount) || 0,
        error: VTU_CUSTOMER_FAILURE_MESSAGE,
        reference: currentRow.request_reference,
        ...(refund.refundIssued &&
          refund.refundedAmount > 0 && {
            refundedToWallet: refund.refundedAmount,
          }),
        status: 'failed',
      };
    }
  } catch (error) {
    if (
      error instanceof RetryableVtuError ||
      error instanceof VtuPersistenceError
    ) {
      throw error;
    }

    console.error('Failed to reconcile processing VTU transaction:', {
      error: error instanceof Error ? error.message : String(error),
      transactionId: row.id,
    });
  }

  return {
    amount: Number(row.amount) || 0,
    reference: row.request_reference,
    status: 'processing',
  };
}

type NormalizedProvider = NonNullable<
  ReturnType<typeof normalizeVtuNetworkProvider>
>;

type ProviderNormalizationResult =
  | { provider: NormalizedProvider }
  | { failure: PurchaseResult };

type VtuPurchaseResult = PurchaseResult & {
  metadataPatch?: Record<string, unknown>;
};

function isMonnifyAirtimeKudaFallbackEligible(
  row: VtuTransactionRow,
  monnifyResult: PurchaseResult
) {
  if (
    row.type !== 'airtime' ||
    monnifyResult.success ||
    monnifyResult.status !== 'failed' ||
    row.amount <= 0
  ) {
    return false;
  }

  const providerErrorDetail = monnifyResult.providerErrorDetail?.trim();
  if (!providerErrorDetail) {
    return false;
  }

  return (
    /\b400\b/i.test(providerErrorDetail) &&
    /(?:vend\s*)?amount must be greater than zero/i.test(providerErrorDetail)
  );
}

function normalizeVtuProviderOrError(
  row: VtuTransactionRow
): ProviderNormalizationResult {
  const provider = normalizeVtuNetworkProvider(row.network_provider);
  if (!provider) {
    return {
      failure: {
        amount: row.amount,
        message: `Invalid network provider: ${row.network_provider}`,
        phoneNumber: row.phone_number,
        provider: row.network_provider,
        reference: row.request_reference,
        status: 'failed',
        success: false,
      },
    };
  }
  return { provider };
}

async function executeVtuPurchase(
  row: VtuTransactionRow,
  merchantName: string,
  supabase: SupabaseClient
): Promise<VtuPurchaseResult> {
  const customerFirstName = getCustomerFirstName(row, merchantName);

  if (row.metadata?.provider === 'monnify') {
    const billerCode =
      typeof row.metadata?.billerCode === 'string'
        ? row.metadata.billerCode
        : '';
    const productCode =
      typeof row.metadata?.productCode === 'string'
        ? row.metadata.productCode
        : '';
    const validationReference =
      typeof row.metadata?.validationReference === 'string'
        ? row.metadata.validationReference
        : undefined;

    const requireValidationRef = row.metadata?.requireValidationRef === true;

    if (!billerCode || !productCode || !row.customer_identifier) {
      return Promise.resolve({
        amount: row.amount,
        message:
          'Missing Monnify billerCode, productCode, or customer identifier',
        reference: row.request_reference,
        status: 'failed',
        success: false,
      });
    }

    if (requireValidationRef && !validationReference) {
      return Promise.resolve({
        amount: row.amount,
        message: 'Missing Monnify validation reference',
        reference: row.request_reference,
        status: 'failed',
        success: false,
      });
    }

    const monnifyResult = await monnifyPurchaseBill(
      billerCode,
      productCode,
      row.customer_identifier,
      row.amount,
      customerFirstName,
      row.request_reference,
      getCustomerPhoneForBill(row),
      validationReference
    );

    if (!isMonnifyAirtimeKudaFallbackEligible(row, monnifyResult)) {
      return monnifyResult;
    }

    const normalized = normalizeVtuProviderOrError(row);
    if ('failure' in normalized) {
      return monnifyResult;
    }

    return executeMonnifyAirtimeKudaFallback({
      customerFirstName,
      monnifyResult,
      provider: normalized.provider,
      row,
      supabase,
    });
  }

  if (row.type === 'airtime') {
    const normalized = normalizeVtuProviderOrError(row);
    if ('failure' in normalized) {
      return Promise.resolve(normalized.failure);
    }

    return purchaseAirtime(
      row.phone_number,
      row.amount,
      normalized.provider,
      customerFirstName,
      row.request_reference
    );
  }

  if (row.type === 'data') {
    const normalized = normalizeVtuProviderOrError(row);
    if ('failure' in normalized) {
      return Promise.resolve(normalized.failure);
    }

    const dataPlanCode =
      typeof row.metadata?.dataPlanCode === 'string'
        ? row.metadata.dataPlanCode
        : '';
    if (!dataPlanCode) {
      return Promise.resolve({
        amount: row.amount,
        message: 'Data plan code is required for data purchases',
        reference: row.request_reference,
        status: 'failed',
        success: false,
      });
    }

    return purchaseData(
      row.phone_number,
      dataPlanCode,
      row.amount,
      normalized.provider,
      customerFirstName,
      row.request_reference
    );
  }

  if (!row.biller_item_code || !row.customer_identifier) {
    return Promise.resolve({
      amount: row.amount,
      message: 'Missing bill item or customer identifier',
      reference: row.request_reference,
      status: 'failed',
      success: false,
    });
  }

  return purchaseBill(
    row.biller_item_code,
    row.customer_identifier,
    row.amount,
    customerFirstName,
    row.request_reference,
    // For electricity/cable_tv/betting, customer_identifier is a meter / decoder
    // / wallet — not a phone. Forward the captured customer phone so Kuda's SMS
    // token delivery (and any biller-side phone validation) works correctly.
    getCustomerPhoneForBill(row)
  );
}

export async function fulfillPendingVtuTransaction({
  retryFailed = false,
  supabase,
  transactionId,
}: {
  retryFailed?: boolean;
  supabase: SupabaseClient;
  transactionId: string;
}): Promise<FulfilledVtuResult> {
  const { data: existing, error: existingError } = await supabase
    .from('vtu_transactions')
    .select(
      'id, merchant_id, customer_id, type, network_provider, phone_number, amount, request_reference, transaction_id, status, metadata, error_message, merchant_commission, customer_cashback, biller_name, biller_item_code, customer_identifier, source, updated_at, created_at, order_id'
    )
    .eq('id', transactionId)
    .single();

  if (existingError || !existing) {
    throw new Error('VTU transaction not found');
  }

  const row = existing as VtuTransactionRow;
  if (row.status === 'successful') {
    return resolveSuccessfulVtuTransaction({ row, supabase });
  }

  if (row.status === 'failed' && !retryFailed) {
    // Existing failed row — issue (or confirm) the wallet refund so the
    // customer can retry from wallet credit. Idempotent. Collection
    // evidence is required here (unlike fresh failures, where this
    // pass's vend attempt proves collection): rows arriving ALREADY
    // failed include legacy gateway-init rows that never collected,
    // and crediting those mints unearned funds. A deliberate
    // no-evidence skip is terminal, not unconfirmed: nothing is
    // retryable, so it returns failed without throwing.
    const refundMetadata = { ...(row.metadata ?? {}) };
    const refund = await refundVtuToCustomerWallet({
      metadata: refundMetadata,
      requireCollectionEvidence: true,
      row,
      supabase,
    });
    throwUnlessRefundSkippedWithoutCollection({
      row,
      refundIssued: refund.refundIssued,
      refundedAmount: refund.refundedAmount,
      refundMetadata,
      failedMessage: row.error_message ?? undefined,
      failedMetadata: getSafeMetadataDiagnostics(refundMetadata),
      message: `Unable to confirm VTU refund before returning failed purchase for ${row.id}`,
    });
    if (refund.metadataChanged) {
      const { error: refundMetadataUpdateError } = await supabase
        .from('vtu_transactions')
        .update({ metadata: refundMetadata })
        .eq('id', row.id);
      if (refundMetadataUpdateError) {
        // Fail closed: the wallet was credited via the (idempotent) RPC, but
        // the row still says refundIssued=false. If we silently returned, a
        // later retryFailed call could miss the metadata flag and re-vend
        // the same row, double-crediting the customer. Surface the failure
        // so the next request retries the metadata write — the RPC will
        // short-circuit on the existing ledger row.
        console.error('Failed to persist VTU refund metadata:', {
          error: refundMetadataUpdateError.message,
          metadata: getSafeMetadataDiagnostics(refundMetadata),
          transactionId: row.id,
        });
        throwVtuPersistenceError(
          `Failed to persist VTU refund metadata for ${row.id}: ${refundMetadataUpdateError.message}`
        );
      }
    }
    // As in the concurrent branch: persisted provider text returns
    // verbatim only with the first-party flag, else the fixed
    // customer-safe message (fail closed).
    const customerSafeError =
      row.metadata?.[VTU_CUSTOMER_SAFE_ERROR_MESSAGE_KEY] === true;
    return {
      amount: Number(row.amount) || 0,
      error:
        customerSafeError && row.error_message
          ? row.error_message
          : VTU_CUSTOMER_FAILURE_MESSAGE,
      reference: row.request_reference,
      ...(refund.refundIssued && { refundedToWallet: refund.refundedAmount }),
      status: 'failed',
    };
  }

  if (row.status === 'processing') {
    const reconciliationRow = await claimProcessingVtuReconciliation({
      row,
      supabase,
    });
    if (!reconciliationRow) {
      // Stranded pre-vend recovery (see vtu-fulfillment-recovery):
      // restore re-drivable strands; settle flagged ones from
      // provider truth (reconcile requeries by reference, never
      // vends).
      const recovery = await recoverStrandedPreVendVtuRow({ row, supabase });
      if (recovery === 'settle-from-provider') {
        return reconcileProcessingVtuTransaction({ row, supabase });
      }
      return resolveCurrentVtuTransactionState({ row, supabase });
    }
    return reconcileProcessingVtuTransaction({
      row: reconciliationRow,
      supabase,
    });
  }

  if (row.status === 'failed' && retryFailed) {
    // Once a failed row has been refunded to the customer wallet, we MUST
    // NOT retry the same row. If the retry succeeded, the customer would
    // keep both the wallet refund AND the successful vend value — a direct
    // monetary loss. The customer should place a new purchase that draws
    // from the wallet credit instead.
    // Source-of-truth check: metadata.refundIssued is a cache; the
    // customer_wallet_transactions ledger is authoritative. If a prior
    // fulfillment crashed between the RPC commit and the metadata update,
    // the cache flag would be missing even though the wallet was already
    // credited. Read the ledger to catch that case before allowing a vend
    // retry that would otherwise double-credit.
    const existingMetadata = (row.metadata ?? {}) as Record<string, unknown>;
    const cachedRefundIssued = existingMetadata.refundIssued === true;
    const ledgerRefund = cachedRefundIssued
      ? null
      : await findExistingVtuRefundLedger({ row, supabase });
    if (cachedRefundIssued || ledgerRefund) {
      const refundAmount =
        Number(existingMetadata.refundAmount) ||
        ledgerRefund?.amount ||
        Number(row.amount) ||
        0;
      return {
        amount: Number(row.amount) || 0,
        error:
          row.error_message ||
          'Original payment was refunded to wallet — please retry as a new purchase.',
        reference: row.request_reference,
        ...(refundAmount > 0 && { refundedToWallet: refundAmount }),
        status: 'failed',
      };
    }
    const reconciliation = await reconcileFailedVtuRetry({ row, supabase });
    if (reconciliation.action === 'return') {
      return reconciliation.result;
    }
  }

  const claimableStatus =
    row.status === 'failed' && retryFailed ? 'failed' : 'pending';
  const { data: claimed, error: claimUpdateError } = await supabase
    .from('vtu_transactions')
    .update({ error_message: null, status: 'processing' })
    .eq('id', transactionId)
    .eq('status', claimableStatus)
    .select('id, updated_at')
    .maybeSingle();

  if (claimUpdateError) {
    console.error('Failed to claim VTU transaction for fulfillment:', {
      error: claimUpdateError.message,
      payload: { error_message: null, status: 'processing' },
      transactionId,
    });
    throw new VtuPersistenceError(
      `Failed to claim VTU transaction ${transactionId}: ${claimUpdateError.message}`
    );
  }

  if (!claimed) {
    return {
      amount: Number(row.amount) || 0,
      reference: row.request_reference,
      status: 'processing',
    };
  }

  // Refresh the snapshot token: the claim above bumped `updated_at`
  // (DB trigger), so the fetch-time value is stale. Downstream
  // pre-vend restores compare-and-set on this token — using the
  // pre-claim value would match zero rows and strand the purchase in
  // processing with no ledger entry for the reconciler to recover
  // (Codex R41 rmh1d). `updated_at` has no other downstream
  // consumers, so the refresh is side-effect-free.
  row.updated_at = claimed.updated_at ?? row.updated_at;

  const { data: merchant } = await supabase
    .from('merchants')
    .select('business_name')
    .eq('id', row.merchant_id)
    .single();

  // === Phase B.5: debit wallet BEFORE vend ===
  // When the customer committed to a hybrid (wallet+card) or wallet-only
  // payment, the wallet leg must clear before Kuda is called. If the
  // wallet RPC raises insufficient_wallet_balance (concurrent redemption
  // / multi-tab / refund race) we MUST NOT vend — we'd be giving away
  // value the customer can't pay for. Compensate by:
  //   - hybrid: refund the gateway-collected card portion only
  //   - wallet-only: nothing was collected; just mark the row failed
  // Idempotent at the RPC layer (advisory lock + uniqueness on
  // source_type='vtu_wallet_payment', source_id, type='redemption'), so
  // a fulfillment retry that already debited returns the cached row and
  // proceeds to the vend.
  const preDebitMetadata = (row.metadata ?? {}) as Record<string, unknown>;
  const paymentSplitForDebit = readPaymentSplit(preDebitMetadata);
  // Mirror the source guard at line 327 in `refundVtuToCustomerWallet`:
  // the refund helper short-circuits for non-checkout rows, which would
  // strand a wallet debit on a non-checkout source if the vend later
  // failed (the customer's wallet would be permanently charged with no
  // automatic refund). Non-checkout flows (loyalty_reward / gift /
  // direct / storefront_modal) MUST NOT debit the wallet — they're
  // either pre-funded by the merchant (loyalty/gift) or follow a
  // different settlement path. Only `checkout` is a customer-paid VTU
  // where wallet credit is the user's chosen payment method.
  if (
    paymentSplitForDebit &&
    paymentSplitForDebit.wallet > 0 &&
    preDebitMetadata.walletDebited !== true &&
    row.customer_id &&
    row.source === 'checkout'
  ) {
    const { error: debitError } = await supabase.rpc(
      'redeem_vtu_wallet_payment',
      {
        p_customer_id: row.customer_id,
        p_merchant_id: row.merchant_id,
        p_amount: paymentSplitForDebit.wallet,
        p_vtu_transaction_id: row.id,
        p_description: `VTU wallet payment: ${VTU_TYPE_LABELS[row.type]} ${getVtuProviderLabel(row)}`,
      }
    );

    if (debitError) {
      // Wallet-race: insufficient balance at debit time. Compensate
      // through refundVtuToCustomerWallet (refunds card portion only;
      // wallet was never debited).
      if (isInsufficientWalletBalanceError(debitError)) {
        const raceMetadata = { ...preDebitMetadata };
        // First-party fixed text (below): flag it safe so replays
        // keep returning it verbatim (Codex R89 P1).
        raceMetadata[VTU_CUSTOMER_SAFE_ERROR_MESSAGE_KEY] = true;
        const raceRefund = await refundVtuToCustomerWallet({
          metadata: raceMetadata,
          row,
          supabase,
          refundContext: 'wallet_race',
        });
        const failedPayload: {
          error_message: string;
          metadata: Record<string, unknown>;
          status: 'failed';
          transaction_id: string | null;
        } = {
          error_message:
            'Wallet balance changed during checkout — payment refunded.',
          metadata: raceMetadata,
          status: 'failed',
          transaction_id: row.transaction_id,
        };
        const persistError = await updateVtuPurchaseResultWithRetry({
          payload: failedPayload,
          expectedStatus: 'processing',
          row,
          supabase,
        });
        if (isVtuConcurrentUpdateError(persistError)) {
          return resolveCurrentVtuTransactionState({ row, supabase });
        }
        if (persistError) {
          console.error('Failed to persist wallet-race VTU result:', {
            error: getErrorMessage(persistError),
            metadata: getSafeMetadataDiagnostics(raceMetadata),
            transactionId: row.id,
          });
          // Deliberately NOT restored to pending (unlike the two
          // sites below): the card-leg refund above may have issued,
          // and re-driving would run it again with no record of the
          // first — a double refund. Pre-existing crash window,
          // unchanged by the pre-vend restore. EXCEPTION (Codex R91
          // P2): the zero-amount wallet-only result proves the
          // card<=0 branch ran, which issues NO refund RPC — nothing
          // can double-run, so restore to marked pending and let the
          // next replay/cron re-drive (balance re-checked; vends or
          // fails cleanly) instead of stranding the retained key on
          // processing forever (never-debited strands match no
          // recovery predicate by design, R39).
          if (raceRefund.refundIssued && raceRefund.refundedAmount <= 0) {
            await restoreInterruptedPreVendVtuRow({
              // Fixed user-safe template (flagged safe inside the
              // restore) — the raw persist error stays in the server
              // log above.
              userSafeMessage:
                'VTU wallet balance changed during checkout; the purchase will resume automatically.',
              row,
              supabase,
            });
          }
          throwVtuPersistenceError('Failed to persist wallet-race VTU result');
        }
        return {
          amount: Number(row.amount) || 0,
          error: failedPayload.error_message,
          reference: row.request_reference,
          ...(raceRefund.refundIssued &&
            raceRefund.refundedAmount > 0 && {
              refundedToWallet: raceRefund.refundedAmount,
            }),
          status: 'failed',
        };
      }
      // Any other RPC error: restore to marked pending so retry AND
      // cron re-drive (the debit RPC is idempotent so re-running is
      // safe), then throw so the caller surfaces 5xx (client keeps
      // the key and replays onto this row).
      console.error('VTU wallet debit RPC failed:', {
        amount: paymentSplitForDebit.wallet,
        customerId: row.customer_id,
        error: debitError.message,
        rpc: 'redeem_vtu_wallet_payment',
        transactionId: row.id,
      });
      await restoreInterruptedPreVendVtuRow({
        // Fixed user-safe template: the raw RPC error stays in the
        // server log above — error_message is customer-visible history.
        userSafeMessage:
          'VTU wallet debit failed; the purchase will resume automatically.',
        row,
        supabase,
      });
      throwVtuPersistenceError(
        `Failed to debit VTU wallet for ${row.id}: ${debitError.message}`
      );
    }

    await persistVtuWalletDebitConfirmation({
      preDebitMetadata,
      row,
      supabase,
    });
  }

  // Submission marker (see vtu-fulfillment-recovery): persist BEFORE
  // the first provider call; throws (after restoring to marked
  // pending) when the write fails.
  await writeVtuProviderSubmissionMarkerOrRestore({ row, supabase });

  let result: VtuPurchaseResult;
  try {
    result = await executeVtuPurchase(
      row,
      merchant?.business_name || 'Customer',
      supabase
    );
  } catch (error) {
    // Lost-race vend (Codex R97 P1): the Kuda fallback marker found
    // another worker's generation — resolve THEIR row (success /
    // confirmed refund / processing replay) instead of persisting
    // our stale failure over their in-flight vend (free airtime).
    if (isVtuConcurrentUpdateError(error)) {
      return resolveCurrentVtuTransactionState({ row, supabase });
    }
    if (!isMonnifyTransientVendError(error)) {
      throw error;
    }

    const retryableMetadata = {
      ...(row.metadata ?? {}),
      monnifyTransientVendError: getErrorMessage(error),
      monnifyTransientVendRetryableAt: new Date().toISOString(),
    };
    // Restore to 'pending' (NOT 'processing'): this row has no provider
    // reference, so the processing-reconcile path could only requery —
    // and Monnify requery without a persisted vendReference returns
    // PENDING forever, stranding the debited row with no re-vend and
    // no refund. 'pending' rows re-enter claim → debit (idempotent
    // short-circuit) → re-vend on client retry AND via the cron, which
    // selects transient-marked pending rows (plain pending orphans
    // stay excluded — the reconciler must never touch mapping-less
    // rows). The caller still reports 'processing' below: the outcome
    // is non-terminal, so clients keep the key and replay.
    const retryableUpdateError = await updateVtuPurchaseResultWithRetry({
      payload: {
        error_message: getErrorMessage(error),
        metadata: retryableMetadata,
        status: 'pending',
        transaction_id: row.transaction_id,
      },
      expectedStatus: 'processing',
      row,
      supabase,
    });

    if (isVtuConcurrentUpdateError(retryableUpdateError)) {
      return resolveCurrentVtuTransactionState({ row, supabase });
    }

    if (retryableUpdateError) {
      console.error('Failed to restore retryable Monnify VTU vend row:', {
        error: getErrorMessage(retryableUpdateError),
        metadata: getSafeMetadataDiagnostics(retryableMetadata),
        transactionId: row.id,
      });
      throwVtuPersistenceError(
        'Failed to restore retryable Monnify VTU vend row'
      );
    }

    return {
      amount: Number(row.amount) || 0,
      reference: row.request_reference,
      status: 'processing',
    };
  }

  // Persist Monnify's vendReference so requery (which resolves by it, not
  // transactionReference) works for any IN_PROGRESS fallback below + later.
  const monnifyVendReference = result.providerVendReference;
  const backfillMetadata = monnifyVendReference
    ? { ...(row.metadata ?? {}), monnifyVendReference }
    : row.metadata;
  let voucherPin = normalizeVoucherPin(result.pin);
  let backfilledUnits: string | undefined;
  // Only backfill the token for a TERMINAL success. A pending vend is persisted
  // as `processing` below and reconciled later (which settles wallet + sends the
  // token notification); backfilling a pin here would leave a processing row
  // that carries a voucherPin — history scheduling skips pinned rows, so it
  // would never settle/notify.
  if (
    !voucherPin &&
    result.status === 'successful' &&
    canResolveBillVoucherPin(row.type)
  ) {
    const backfilled = await backfillVtuVoucherPin({
      billRequestRef: row.request_reference,
      billResponseReference: result.transactionId ?? row.transaction_id,
      metadata: backfillMetadata,
      supabase,
      transactionId: row.id,
    });
    voucherPin = backfilled.voucherPin;
    backfilledUnits = backfilled.units;
  }
  // Inline vend units take precedence; otherwise use units resolved via requery.
  const units = result.units || backfilledUnits;
  const providerErrorDetail = result.success
    ? undefined
    : result.providerErrorDetail?.trim();
  const updatedMetadata: Record<string, unknown> = {
    ...(row.metadata ?? {}),
    ...(result.metadataPatch ?? {}),
    ...(monnifyVendReference && { monnifyVendReference }),
    ...(units && { units }),
    ...(voucherPin && { voucherPin }),
  };
  // This result's error text is provider-authored: drop any prior
  // safe-message flag it may have inherited, so a later replay never
  // mistakes the persisted provider text for first-party copy (the
  // replay check fails closed on a missing flag).
  delete updatedMetadata[VTU_CUSTOMER_SAFE_ERROR_MESSAGE_KEY];
  if (providerErrorDetail) {
    updatedMetadata.providerErrorDetail = providerErrorDetail;
  } else {
    delete updatedMetadata.providerErrorDetail;
  }

  if (result.status === 'pending') {
    const processingUpdatePayload: {
      error_message: string | null;
      metadata: Record<string, unknown>;
      status: 'processing';
      transaction_id: string | null;
    } = {
      error_message: result.message,
      metadata: updatedMetadata,
      status: 'processing',
      transaction_id: result.transactionId ?? row.transaction_id,
    };
    const processingUpdateError = await updateVtuPurchaseResultWithRetry({
      payload: processingUpdatePayload,
      expectedStatus: 'processing',
      row,
      supabase,
    });

    if (isVtuConcurrentUpdateError(processingUpdateError)) {
      return resolveCurrentVtuTransactionState({ row, supabase });
    }

    if (processingUpdateError) {
      // No errorMessage field: the payload message is the provider
      // body and must never enter logs (Codex R90 P1, same class as
      // the overlay refresh warn). Tx id + provider reference below
      // are the correlation keys.
      console.error('Failed to persist processing VTU purchase result:', {
        error: getErrorMessage(processingUpdateError),
        metadata: getSafeMetadataDiagnostics(updatedMetadata),
        status: processingUpdatePayload.status,
        transactionId: row.id,
        transactionReference: processingUpdatePayload.transaction_id,
      });
      throwVtuPersistenceError('Failed to persist processing VTU result');
    }

    return {
      amount: Number(row.amount) || 0,
      reference: row.request_reference,
      status: 'processing',
    };
  }

  const purchaseUpdatePayload: {
    customer_cashback?: number;
    error_message: string | null;
    merchant_commission?: number;
    metadata: Record<string, unknown>;
    platform_commission?: number;
    status: 'successful' | 'failed';
    transaction_id: string | null;
  } = {
    error_message: result.success ? null : result.message,
    metadata: updatedMetadata,
    status: result.success ? 'successful' : 'failed',
    transaction_id: result.transactionId ?? row.transaction_id,
  };
  const fallbackCreditCorrection = result.success
    ? applyKudaFallbackCreditCorrection({ metadata: updatedMetadata, row })
    : null;
  if (fallbackCreditCorrection) {
    purchaseUpdatePayload.customer_cashback =
      fallbackCreditCorrection.customerCashback;
    purchaseUpdatePayload.merchant_commission =
      fallbackCreditCorrection.merchantCommission;
    purchaseUpdatePayload.platform_commission =
      fallbackCreditCorrection.platformCommission;
  }
  const purchaseUpdateError = await updateVtuPurchaseResultWithRetry({
    payload: purchaseUpdatePayload,
    expectedStatus: 'processing',
    row,
    supabase,
  });

  if (isVtuConcurrentUpdateError(purchaseUpdateError)) {
    return resolveCurrentVtuTransactionState({
      reconciledVoucherPin: voucherPin,
      reconciledUnits: units,
      row,
      supabase,
    });
  }

  if (purchaseUpdateError) {
    // No errorMessage field: same provider-body log ban as above.
    console.error('Failed to persist VTU purchase result:', {
      attempts: PURCHASE_RESULT_UPDATE_MAX_ATTEMPTS,
      error: getErrorMessage(purchaseUpdateError),
      metadata: getSafeMetadataDiagnostics(updatedMetadata),
      persistenceRetryExhausted: true,
      status: purchaseUpdatePayload.status,
      transactionId: row.id,
      transactionReference: purchaseUpdatePayload.transaction_id,
    });
    throwVtuPersistenceError('Failed to persist VTU purchase result');
  }

  if (!result.success) {
    // Fresh vend failure: refund the customer wallet so they can retry from
    // credit. Idempotent at the RPC layer; safe to call on retries.
    const refundMetadata = { ...updatedMetadata };
    const refund = await refundVtuToCustomerWallet({
      metadata: refundMetadata,
      row,
      supabase,
    });
    if (refund.metadataChanged) {
      const { error: refundMetadataUpdateError } = await supabase
        .from('vtu_transactions')
        .update({ metadata: refundMetadata })
        .eq('id', row.id);
      if (refundMetadataUpdateError) {
        // Fail closed — see the matching block above for rationale: the
        // wallet was already credited via the idempotent RPC, so silently
        // continuing here would let a later retry re-vend the same row.
        console.error('Failed to persist VTU refund metadata:', {
          error: refundMetadataUpdateError.message,
          metadata: getSafeMetadataDiagnostics(refundMetadata),
          transactionId: row.id,
        });
        throwVtuPersistenceError(
          `Failed to persist VTU refund metadata for ${row.id}: ${refundMetadataUpdateError.message}`
        );
      }
    }
    // Fresh vend failure with an unconfirmed wallet refund: fail retryable
    // (routes map this to 5xx) so both clients keep their idempotency key
    // and the retry dedupes onto this same row, re-attempting the refund —
    // instead of minting a fresh debit while the original charge stands
    // unreversed.
    throwIfVtuRefundUnconfirmed({
      row,
      refundIssued: refund.refundIssued,
      refundedAmount: refund.refundedAmount,
      failedMessage: result.message ?? undefined,
      failedMetadata: getSafeMetadataDiagnostics(refundMetadata),
      message: `Unable to confirm VTU refund for failed purchase ${row.id}`,
    });
    // Provider diagnostics (result.message) are persisted raw in
    // error_message for support correlation but must never reach the
    // response — return the fixed customer-safe message instead
    // (Codex R89 P1). Telemetry carries only the transaction id and
    // provider, never the provider body.
    console.error('Fresh VTU vend failed:', {
      provider: result.provider ?? row.network_provider,
      transactionId: row.id,
    });
    return {
      amount: Number(row.amount) || 0,
      error: VTU_CUSTOMER_FAILURE_MESSAGE,
      reference: row.request_reference,
      ...(refund.refundIssued && { refundedToWallet: refund.refundedAmount }),
      status: 'failed',
    };
  }

  const cashbackAmount = Number(row.customer_cashback ?? 0);
  const finalMetadata = { ...updatedMetadata };
  // Deep baseline for the CAS merge below (see resolveSuccessful).
  const preSettlementMetadata = JSON.parse(
    JSON.stringify(updatedMetadata)
  ) as Record<string, unknown>;
  const walletSettlement = await settleVtuWalletCredits({
    metadata: finalMetadata,
    row,
    supabase,
  });
  const loyaltyPoints = await awardVtuAirtimeLoyaltyPoints({
    metadata: finalMetadata,
    row,
    supabase,
  });
  const notificationSettlement = await notifyVtuCustomerSuccess({
    cashbackAmount,
    customerWalletCredited: walletSettlement.customerWalletCredited,
    metadata: finalMetadata,
    row,
    supabase,
  });
  const paymentPendingMetadataChanged = setMetadataValue(
    finalMetadata,
    'paymentPending',
    false
  );
  const metadataChanged =
    walletSettlement.metadataChanged ||
    loyaltyPoints.metadataChanged ||
    notificationSettlement.metadataChanged ||
    paymentPendingMetadataChanged;

  if (metadataChanged) {
    // CAS-merged (Codex R82 P2): same concurrent-settlement race as
    // the reconcile path above.
    await mergeVtuSettlementMetadata({
      baselineMetadata: preSettlementMetadata,
      mutatedMetadata: finalMetadata,
      rowId: row.id,
      supabase,
    });
  }

  return {
    amount: Number(row.amount) || 0,
    cashback:
      cashbackAmount > 0
        ? {
            amount: cashbackAmount,
            credited: walletSettlement.customerWalletCredited,
            newBalance: walletSettlement.customerNewBalance,
          }
        : undefined,
    customerIdentifier: row.customer_identifier ?? undefined,
    ...(loyaltyPoints.credited
      ? {
          loyaltyPoints: {
            credited: loyaltyPoints.credited,
            earned: loyaltyPoints.earned,
            ...(loyaltyPoints.newBalance !== undefined
              ? { newBalance: loyaltyPoints.newBalance }
              : {}),
          },
        }
      : {}),
    reference: row.request_reference,
    status: 'successful',
    ...(voucherPin && { voucherPin }),
  };
}
