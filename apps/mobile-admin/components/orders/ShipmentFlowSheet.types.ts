import type { Order } from '@baci/shared';
import type { useOrderGiglShipping } from '@/hooks/orders/useOrderGiglShipping';
import type {
  ShipmentCompletionMode,
  ShipmentFlowStep,
  ShipmentFulfillmentDetails,
} from '@/lib/order-shipment';

export interface ShipmentFlowSheetProps {
  recoveryOrder?: Order;
  canUseProvider: boolean;
  fulfillmentDetails: ShipmentFulfillmentDetails;
  fulfillmentItemIndex: number;
  giglShipping?: ReturnType<typeof useOrderGiglShipping>;
  hasExistingFulfillment: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onContinueFromDetails: () => void;
  onContinueFromMethod:
    | (() => void)
    | (() =>
        | 'review_checkout_quote'
        | undefined
        | Promise<'review_checkout_quote' | undefined>);
  onConfirmSelfFulfillment: () => void;
  onFulfillmentDetailsChange: (
    field: 'imei' | 'serialNumber',
    value: string
  ) => void;
  onModeChange: (mode: ShipmentCompletionMode) => void;
  onRiderPhoneChange: (value: string) => void;
  onSelectSavedRider: (phone: string) => void;
  onStepBack: () => void;
  orderNumber: string;
  providerLabel: string | null;
  requiresFulfillment: boolean;
  riderPhone: string;
  savedRiders: string[];
  selectedMode: ShipmentCompletionMode;
  step: ShipmentFlowStep;
  visible: boolean;
}
