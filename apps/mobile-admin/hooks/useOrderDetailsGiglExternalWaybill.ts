import { useOrderGiglExternalWaybill } from '@/hooks/orders/useOrderGiglExternalWaybill';
import { useGiglAdminShippingEligibility } from '@/hooks/useGiglAdminShippingEligibility';
import { useMerchant } from '@/hooks/useMerchant';
import type { OrderDetailsSuccessModalState } from '@/hooks/useOrderDetailsUiState';

interface UseOrderDetailsGiglExternalWaybillParams {
  closeShipmentFlow: () => void;
  orderId: string;
  orderNumber: string;
  setSuccessModal: (value: OrderDetailsSuccessModalState) => void;
}

/**
 * Ship Order's "Already booked on GIG?" option. Offered to anyone who can
 * ship orders when the store has GIG Logistics turned on; the server enforces
 * the fulfil/edit permission, GIG account ownership and the receiver match.
 */
export function useOrderDetailsGiglExternalWaybill({
  closeShipmentFlow,
  orderId,
  orderNumber,
  setSuccessModal,
}: UseOrderDetailsGiglExternalWaybillParams) {
  const { merchant } = useMerchant();
  const { isEligible } = useGiglAdminShippingEligibility(merchant);
  const externalWaybill = useOrderGiglExternalWaybill({
    orderId,
    onLinked: ({ trackingNumber }) => {
      closeShipmentFlow();
      setSuccessModal({
        actionLabel: '',
        actionVariant: 'default',
        message: `GIG waybill ${trackingNumber} is now tracked on order ${orderNumber}.`,
        showAction: false,
        subMessage:
          'Baci will follow the parcel and update you and the customer as it moves.',
        title: 'Waybill attached',
        visible: true,
      });
    },
  });

  return isEligible ? externalWaybill : undefined;
}
