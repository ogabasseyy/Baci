import {
  type CancellationRefundDetails,
  getCancelRefundPlan,
  readCancellationSideEffects,
} from '@baci/shared';
import { useState } from 'react';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import { apiPost } from '@/lib/api-client';
import { formatDisplayCurrency } from '@/lib/format-display-currency';
import { createClient } from '@/lib/supabase/client';
import type { Order } from '../actions';
import type { CancelRefundChoice } from './cancel-order-dialog';

interface CancelResponse {
  sideEffects?: unknown;
  success?: boolean;
}

/**
 * Open provider-refund evidence (or a failed check) means money may already
 * have moved, so no manual repayment may be offered or confirmed.
 */
async function refundEvidenceBlocksChoice(orderId: string): Promise<boolean> {
  try {
    const { data, error } = await createClient().rpc(
      'order_has_unresolved_refund_evidence',
      { p_order_id: orderId }
    );
    return Boolean(error) || data !== false;
  } catch {
    return true;
  }
}

function manualRefundMessage(
  details: CancellationRefundDetails | undefined
): string {
  const record =
    'Record the refund from the Refund card once you have paid the customer.';
  if (!details || details.inFlightAmount <= 0) {
    return `Refund pending. ${record}`;
  }
  const money = (value: number) =>
    formatDisplayCurrency(value, details.currency || 'NGN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return `${money(details.inFlightAmount)} is already being refunded by the provider; you only need to refund ${money(details.remainingAmount)}. ${record}`;
}

/**
 * Merchant cancellation for the order page: the refund plan, the choice
 * dialog (remounted per open so it starts from the safe default), the
 * request, and the outcome toast worded from what the server reports.
 */
export function useOrderCancellation({
  onCancelled,
  order,
}: {
  onCancelled: () => void;
  order: Order;
}) {
  const { toast } = useToast();
  const merchantContext = useMerchantSafe();
  const plan = getCancelRefundPlan({
    ...order,
    // Missing means unreadable: the plan then stays neutral.
    amountPaid: order.amountPaid ?? null,
    orderCurrency: order.currency,
  });
  const [isOpen, setIsOpen] = useState(false);
  const [session, setSession] = useState(0);

  const submit = async (refund?: CancelRefundChoice): Promise<boolean> => {
    try {
      const response = await apiPost<CancelResponse>(
        `/api/orders/${order.id}/cancelled`,
        {
          cancelled_by: 'merchant',
          confirm_cancellation: true,
          ...(refund && { refund }),
        }
      );
      onCancelled();
      // A replay keeps the persisted mode, so trust the response over the
      // requested choice when it says what it did.
      // Malformed details arrive as an `unknown` outcome without amounts.
      const { details, outcome } = readCancellationSideEffects(
        response?.sideEffects
      );
      // Only an explicit manual_required (or, with no outcome in the
      // response, the explicit manual choice) may tell the merchant to
      // repay by hand; an unknown outcome stays neutral.
      const manualRequired = outcome
        ? outcome === 'manual_required'
        : refund === 'manual';
      toast({
        title: 'Order status updated to Canceled',
        ...(manualRequired && {
          description: manualRefundMessage(details),
        }),
        ...(outcome === 'unknown' && {
          description:
            "Cancelled. Check the order's Refund card for refund status.",
        }),
      });
      return true;
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to update order status',
      });
      return false;
    }
  };

  const requestCancellation = async () => {
    // Without a readable ledger we cannot say what is owed, so never offer a
    // manual refund: cancel neutrally and point at the Refund card.
    if (
      !plan.ledgerKnown ||
      (plan.amount > 0 && (await refundEvidenceBlocksChoice(order.id)))
    ) {
      if (
        !window.confirm(
          "Refund details couldn't be loaded. Cancel this order now and check its Refund card for what happens next; do not refund the customer by hand until it shows what is owed. Continue?"
        )
      )
        return;
      await submit();
      return;
    }
    // A paid order with money the worker could refund asks how to refund in
    // a dialog; everything else keeps the plain confirmation.
    if (plan.amount > 0) {
      setSession((value) => value + 1);
      setIsOpen(true);
      return;
    }
    const warning =
      plan.inFlightAmount > 0
        ? 'A refund is already in progress with the provider. Cancelling will not send another one, so wait for it to finish instead of refunding the customer yourself. Continue?'
        : order.paymentStatus === 'Paid'
          ? 'This is a paid order. Cancelling records your account as the actor and starts the refund workflow. Continue?'
          : 'Cancel this order and restore its tracked inventory?';
    if (!window.confirm(warning)) return;
    await submit();
  };

  return {
    dialogKey: session,
    dialogProps: {
      automaticSupported: plan.automaticSupported,
      inFlightAmount: plan.inFlightAmount,
      // Fail closed: cancel-only stays hidden until the permission resolves;
      // the review-labelled automatic action is always available.
      canCancelOnly:
        merchantContext?.hasPermission('orders', 'refund') ?? false,
      isOpen,
      onClose: () => setIsOpen(false),
      onConfirm: async (refund: CancelRefundChoice) => {
        // Keep the dialog (and the merchant's choice) open on failure.
        if (await submit(refund)) setIsOpen(false);
      },
      refundAmount: plan.amount,
    },
    requestCancellation,
  };
}
