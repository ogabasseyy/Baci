import { withConfirmedWalletDebit } from '../checkout-fingerprints-match';
import type { PendingCheckoutOrderSnapshot } from '../pending-checkout-order';
import type { CommittedCheckoutOrderFailure } from './submit-checkout-order';

export interface BuildCommittedFailureSnapshotOptions {
  failure: CommittedCheckoutOrderFailure;
  merchantId: string;
  customerEmail: string;
  customerPhone: string;
  fingerprint: string;
  previousFingerprint?: string;
  paymentMethod: string;
  fallbackTotal: number;
  now?: () => string;
}

/**
 * Freeze the order and confirmed wallet debit locally whenever pre-gateway
 * credit projection fails so reloads and method switches keep the order
 * fenced rather than allowing replacement invoices.
 */
export function buildCommittedFailureCheckoutSnapshot({
  failure,
  merchantId,
  customerEmail,
  customerPhone,
  fingerprint,
  previousFingerprint,
  paymentMethod,
  fallbackTotal,
  now = () => new Date().toISOString(),
}: BuildCommittedFailureSnapshotOptions): PendingCheckoutOrderSnapshot {
  const committedWalletUsed = failure.wallet?.amountUsed;
  const hasCommittedWallet =
    typeof committedWalletUsed === 'number' &&
    Number.isFinite(committedWalletUsed) &&
    committedWalletUsed > 0;
  return {
    orderId: failure.orderId,
    ...(failure.orderNumber ? { orderNumber: failure.orderNumber } : {}),
    ...(failure.trackingToken ? { trackingToken: failure.trackingToken } : {}),
    merchantId,
    customerEmail,
    customerPhone,
    checkoutFingerprint: hasCommittedWallet
      ? withConfirmedWalletDebit(
          fingerprint,
          committedWalletUsed,
          previousFingerprint
        )
      : fingerprint,
    paymentMethod,
    amountDueToGateway: failure.amountDueToGateway ?? fallbackTotal,
    ...(hasCommittedWallet ? { walletAmountUsed: committedWalletUsed } : {}),
    fundingUnresolved: true,
    ...(failure.code === 'STORE_CREDIT_RETRY_REQUIRED'
      ? { fundingRetryable: true }
      : {}),
    createdAt: now(),
  };
}

export interface BuildCreatedOrderSnapshotOptions {
  order: {
    id: string;
    order_number?: string;
    tracking_token?: string;
  };
  walletAmountUsed?: number;
  merchantId: string;
  customerEmail: string;
  customerPhone: string;
  fingerprint: string;
  paymentMethod: string;
  amountDueToGateway: number;
  previousOrder?: PendingCheckoutOrderSnapshot;
  redvaultRecovery?: PendingCheckoutOrderSnapshot['redvaultReview'];
  now?: () => string;
}

/**
 * Persist the latest server-confirmed order + wallet/Redvault fence state.
 */
export function buildCreatedOrderCheckoutSnapshot({
  order,
  walletAmountUsed,
  merchantId,
  customerEmail,
  customerPhone,
  fingerprint,
  paymentMethod,
  amountDueToGateway,
  previousOrder,
  redvaultRecovery,
  now = () => new Date().toISOString(),
}: BuildCreatedOrderSnapshotOptions): PendingCheckoutOrderSnapshot {
  const effectiveWallet = walletAmountUsed ?? previousOrder?.walletAmountUsed;
  const shouldUseConfirmedDebit =
    Boolean(effectiveWallet && effectiveWallet > 0) &&
    (paymentMethod === 'credit_direct' || paymentMethod === 'oxygen');
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    trackingToken: order.tracking_token,
    merchantId,
    customerEmail,
    customerPhone,
    checkoutFingerprint: shouldUseConfirmedDebit
      ? withConfirmedWalletDebit(
          fingerprint,
          effectiveWallet as number,
          previousOrder?.checkoutFingerprint
        )
      : fingerprint,
    paymentMethod,
    amountDueToGateway,
    ...(effectiveWallet && effectiveWallet > 0
      ? { walletAmountUsed: effectiveWallet }
      : {}),
    createdAt: now(),
    ...(redvaultRecovery ? { redvaultReview: redvaultRecovery } : {}),
  };
}
