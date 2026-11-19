import { useOrderGiglExternalWaybill } from '@/hooks/orders/useOrderGiglExternalWaybill';
import { useGiglAdminShippingEligibility } from '@/hooks/useGiglAdminShippingEligibility';
import { useMerchant } from '@/hooks/useMerchant';
import type { OrderDetailsSuccessModalState } from '@/hooks/useOrderDetailsUiState';
import {
  buildOrderFulfillmentDetailsForPersistence,
  type ShipmentFulfillmentDetails,
  shouldPersistFulfillmentDetails,
} from '@/lib/order-shipment';
import { supabase } from '@/lib/supabase';

interface UseOrderDetailsGiglExternalWaybillParams {
  closeShipmentFlow: () => void;
  fulfillmentDetails: ShipmentFulfillmentDetails;
  orderId: string;
  orderNumber: string;
  runAfterShipmentFlowDismissed: (task: () => void) => void;
  setSuccessModal: (value: OrderDetailsSuccessModalState) => void;
}

/**
 * Ship Order's "Already booked on GIG?" option. Offered to anyone who can
 * ship orders when the store has GIG Logistics turned on; the server enforces
 * the fulfil/edit permission, GIG account ownership and the receiver match.
 */
export function useOrderDetailsGiglExternalWaybill({
  closeShipmentFlow,
  fulfillmentDetails,
  orderId,
  orderNumber,
  runAfterShipmentFlowDismissed,
  setSuccessModal,
}: UseOrderDetailsGiglExternalWaybillParams) {
  const { merchant } = useMerchant();
  const { isEligible } = useGiglAdminShippingEligibility(merchant);
  const externalWaybill = useOrderGiglExternalWaybill({
    // Same save the provider and rider paths make before shipping, so device
    // identifiers entered in the details step are never dropped.
    beforeLink: async () => {
      if (!shouldPersistFulfillmentDetails(fulfillmentDetails)) return;
      if (!merchant?.id) {
        throw new Error(
          'Merchant information is unavailable. Please try again.'
        );
      }
      const { error } = await supabase
        .from('orders')
        .update({
          fulfillment_details:
            buildOrderFulfillmentDetailsForPersistence(fulfillmentDetails),
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .eq('merchant_id', merchant.id);
      if (error) {
        throw new Error(
          'Could not save the IMEI or serial numbers. Please try again.'
        );
      }
    },
    orderId,
    onLinked: ({ trackingNumber }) => {
      closeShipmentFlow();
      // Wait for the sheet's exit animation, as the provider and rider paths
      // do, so iOS doesn't swallow the dialog with the closing sheet.
      runAfterShipmentFlowDismissed(() =>
        setSuccessModal({
          actionLabel: '',
          actionVariant: 'default',
          message: `GIG waybill ${trackingNumber} is now tracked on order ${orderNumber}.`,
          showAction: false,
          subMessage:
            'Baci will follow the parcel and update you and the customer as it moves.',
          title: 'Waybill attached',
          visible: true,
        })
      );
    },
  });

  return isEligible ? externalWaybill : undefined;
}
