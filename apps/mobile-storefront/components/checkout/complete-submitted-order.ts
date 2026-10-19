import { runCheckoutFinalization } from './run-checkout-finalization';
import { runRedvaultPostOrderBranch } from './run-redvault-post-order-branch';

type RedvaultParams = Parameters<typeof runRedvaultPostOrderBranch>[0];
type FinalizationParams = Parameters<typeof runCheckoutFinalization>[0];

/** Fields either post-order branch consumes for one created order. */
export interface CompleteSubmittedOrderParams
  extends Omit<RedvaultParams, 'selectedPayment'>,
    FinalizationParams {}

/**
 * Runs the REDVAULT post-order branch when it claims the order, then
 * the standard checkout finalization. Returns true when the REDVAULT
 * branch handled completion and the caller must stop.
 */
export async function completeSubmittedOrder(
  params: CompleteSubmittedOrderParams
): Promise<boolean> {
  if (
    await runRedvaultPostOrderBranch({
      accountPassword: params.accountPassword,
      address: params.address,
      checkoutGeneration: params.checkoutGeneration,
      completedPaymentMethod: params.completedPaymentMethod,
      customer: params.customer,
      customerEmail: params.customerEmail,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      isAuthenticated: params.isAuthenticated,
      itemsSnapshot: params.itemsSnapshot,
      onRedvaultOrder: params.onRedvaultOrder,
      order: params.order,
      orderNumber: params.orderNumber,
      orderResponse: params.orderResponse,
      saveAsDefaultAddress: params.saveAsDefaultAddress,
      saveDetails: params.saveDetails,
      selectedPayment: params.selectedPayment,
      selectedSavedAddressId: params.selectedSavedAddressId,
      snapshot: params.snapshot,
    })
  ) {
    return true;
  }
  await runCheckoutFinalization(params);
  return false;
}
