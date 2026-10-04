import type { ReactNode } from 'react';
import { OrderReconciliationErrorView } from '@/components/orders/OrderReconciliationErrorView';
import type Colors from '@/constants/Colors';

interface ParamVerificationGateInput {
  isParamReconciliation: boolean;
  paramReconciliationVerified: boolean | undefined;
  isParamVerificationExhausted: boolean;
  retryParamVerification: () => void;
  colors: typeof Colors.light;
  isDark: boolean;
  orderNumber?: string;
  onContinueShopping: () => void;
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
  isParamReconciliation,
  paramReconciliationVerified,
  isParamVerificationExhausted,
  retryParamVerification,
  colors,
  isDark,
  orderNumber,
  onContinueShopping,
}: ParamVerificationGateInput): ReactNode | undefined {
  const unresolved =
    isParamReconciliation && paramReconciliationVerified === undefined;
  if (unresolved && !isParamVerificationExhausted) {
    return null;
  }
  if (unresolved && isParamVerificationExhausted) {
    return (
      <OrderReconciliationErrorView
        colors={colors}
        isDark={isDark}
        orderNumber={orderNumber}
        onRetry={retryParamVerification}
        onContinueShopping={onContinueShopping}
      />
    );
  }
  return undefined;
}
