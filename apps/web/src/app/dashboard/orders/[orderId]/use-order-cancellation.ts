import { getCancelRefundPlan } from '@baci/shared/lib/cancel-refund-plan';
import { useState } from 'react';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import { apiPost } from '@/lib/api-client';
import type { Order } from '../actions';
import type { CancelRefundChoice } from './cancel-order-dialog';

interface CancelResponse {
  sideEffects?: { refund?: string };
  success?: boolean;
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
  const plan = getCancelRefundPlan(order);
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
      const manualRequired = response?.sideEffects?.refund
        ? response.sideEffects.refund === 'manual_required'
        : refund === 'manual';
      toast({
        title: 'Order status updated to Canceled',
        ...(manualRequired && {
          description:
            'Refund pending. Record the refund from the Refund card once you have paid the customer.',
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
      canCancelOnly: merchantContext?.hasPermission('orders', 'refund') ?? true,
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
