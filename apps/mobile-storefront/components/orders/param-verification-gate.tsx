import type { ReactNode } from 'react';
import { OrderReconciliationErrorView } from '@/components/orders/OrderReconciliationErrorView';
import type Colors from '@/constants/Colors';

interface ParamVerificationGateInput {
  invalidPaymentLink: boolean;
  isParamReconciliation: boolean;
  paramReconciliationVerified: boolean | undefined;
  isParamVerificationExhausted: boolean;
  retryParamVerification: () => void;
  colors: typeof Colors.light;
  isDark: boolean;
  orderNumber?: string;
  onContinueShopping: () => void;
  onViewOrders: () => void;
}

/**
 * Renders the reconciliation parameter's unresolved states, or undefined
 * when the screen should continue to its normal content. Pending stays
 * blank (a spoofed param must not borrow success credibility); exhausted
 * fails closed on an explicit error state with a manual retry — never
 * the success banner, never the reconciliation state.
 * Extracted from the order-success screen (300-line file limit).
 */
export function renderParamVerificationGate({
  invalidPaymentLink,
  isParamReconciliation,
  paramReconciliationVerified,
  isParamVerificationExhausted,
  retryParamVerification,
  colors,
  isDark,
  orderNumber,
  onContinueShopping,
  onViewOrders,
}: ParamVerificationGateInput): ReactNode | undefined {
  const unresolved =
    isParamReconciliation && paramReconciliationVerified === undefined;
  if (invalidPaymentLink || (unresolved && isParamVerificationExhausted)) {
    return (
      <OrderReconciliationErrorView
        colors={colors}
        isDark={isDark}
        invalidPaymentLink={invalidPaymentLink}
        orderNumber={invalidPaymentLink ? undefined : orderNumber}
        onRetry={invalidPaymentLink ? undefined : retryParamVerification}
        onViewOrders={invalidPaymentLink ? onViewOrders : undefined}
        onContinueShopping={onContinueShopping}
      />
    );
  }
  return unresolved ? null : undefined;
}
