import type Ionicons from '@react-native-vector-icons/ionicons';
import type { ComponentProps } from 'react';

/**
 * Purchase-success presentation: message copy, receipt visibility,
 * and status chrome.
 *
 * Extracted from `PurchaseSuccess.tsx` (Codex R112 P1 — the
 * component exceeded the 300-line ceiling). Pure and
 * platform-agnostic; the component keeps props + render only.
 */

export type PurchaseStatus =
  | 'processing'
  | 'successful'
  | 'failed'
  | 'error'
  | 'cancelled';

export type IoniconsName = ComponentProps<typeof Ionicons>['name'];

const TYPE_LABELS: Record<string, string> = {
  airtime: 'airtime',
  data: 'data',
  tv: 'TV subscription',
  power: 'electricity',
  gaming: 'betting',
};

export function isTokenGeneratingType(type: string) {
  return type === 'power' || type === 'tv' || type === 'gaming';
}

export function getPurchaseMessage({
  identifier,
  refundConfirmed,
  refundSkipped,
  status,
  type,
}: {
  identifier: string;
  refundConfirmed: boolean | null | undefined;
  refundSkipped: boolean | null | undefined;
  status: PurchaseStatus;
  type: string;
}) {
  const typeLabel = TYPE_LABELS[type] || type;

  switch (status) {
    case 'processing': {
      const action = isTokenGeneratingType(type)
        ? 'generating your token'
        : 'completing your purchase';
      return identifier
        ? `Your ${typeLabel} payment for ${identifier} was received. We are ${action} now.`
        : `Your ${typeLabel} payment was received. We are ${action} now.`;
    }
    case 'failed':
      // Wallet-only flow, gated on proof: the refunded claim renders
      // ONLY with refundConfirmed. Without it (a future caller passing
      // failed from route params or a deep link) the copy stays soft.
      // Skipped rows were never charged (Codex R110 P2): explicit
      // no-charge copy, never the refunded claim.
      if (refundConfirmed === true) {
        return identifier
          ? `Your ${typeLabel} purchase for ${identifier} failed. Your wallet has been refunded — please try again.`
          : `Your ${typeLabel} purchase failed. Your wallet has been refunded — please try again.`;
      }
      if (refundSkipped === true) {
        return identifier
          ? `Your ${typeLabel} purchase for ${identifier} failed. No charge was made to your wallet — please try again.`
          : `Your ${typeLabel} purchase failed. No charge was made to your wallet — please try again.`;
      }
      return identifier
        ? `Your ${typeLabel} purchase for ${identifier} failed. Please check your wallet balance and try again.`
        : `Your ${typeLabel} purchase failed. Please check your wallet balance and try again.`;
    case 'cancelled':
      return identifier
        ? `Your ${typeLabel} payment for ${identifier} was cancelled.`
        : `Your ${typeLabel} payment was cancelled.`;
    case 'error':
      return identifier
        ? `We could not complete your ${typeLabel} purchase for ${identifier}. Please try again.`
        : `We could not complete your ${typeLabel} purchase. Please try again.`;
    case 'successful':
      return identifier
        ? `Your ${typeLabel} purchase for ${identifier} was successful.`
        : `Your ${typeLabel} purchase was successful.`;
    default:
      return assertNever(status);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled purchase status: ${value}`);
}

export function getReceiptStatus(
  status: PurchaseStatus
): 'processing' | 'successful' | null {
  switch (status) {
    case 'processing':
      return 'processing';
    case 'successful':
      return 'successful';
    case 'failed':
    case 'error':
    case 'cancelled':
      return null;
    default:
      return assertNever(status);
  }
}

export function getPurchasePresentation(status: PurchaseStatus): {
  canShareReceipt: boolean;
  iconName: IoniconsName;
  isProcessing: boolean;
  title: string;
} {
  switch (status) {
    case 'processing':
      return {
        canShareReceipt: true,
        iconName: 'time-outline',
        isProcessing: true,
        title: 'Payment Received',
      };
    case 'failed':
      return {
        canShareReceipt: false,
        iconName: 'alert-circle',
        isProcessing: false,
        title: 'Purchase Failed',
      };
    case 'error':
      return {
        canShareReceipt: false,
        iconName: 'alert-circle',
        isProcessing: false,
        title: 'Purchase Error',
      };
    case 'cancelled':
      return {
        canShareReceipt: false,
        iconName: 'close-circle',
        isProcessing: false,
        title: 'Payment Cancelled',
      };
    case 'successful':
      return {
        canShareReceipt: true,
        iconName: 'checkmark-circle',
        isProcessing: false,
        title: 'Purchase Successful!',
      };
    default:
      return assertNever(status);
  }
}
