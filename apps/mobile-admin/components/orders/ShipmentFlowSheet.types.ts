import type { Order } from '@baci/shared';
import type { OrderGiglExternalWaybill } from '@/hooks/orders/useOrderGiglExternalWaybill';
import type { useOrderGiglShipping } from '@/hooks/orders/useOrderGiglShipping';
import type {
  ShipmentCompletionMode,
  ShipmentFlowStep,
  ShipmentFulfillmentDetails,
} from '@/lib/order-shipment';

export interface ShipmentFlowSheetProps {
  recoveryOrder?: Order;
  /**
   * Owner, or staff with orders.fulfill and orders.edit: may select, fund and
   * book GIG and recover a checkout GIG destination. Anyone else only sees the
   * GIG price.
   */
  canBookGigl: boolean;
  canUseProvider: boolean;
  /** The order ships with GIG; only then can GIG booking rights withhold it. */
  isGiglOrder?: boolean;
  checkoutPaidShippingLabel?: string | null;
  /** Attach a waybill booked in GIG's own app; omitted when GIG is off. */
  externalWaybill?: OrderGiglExternalWaybill;
  fulfillmentDetails: ShipmentFulfillmentDetails;
  fulfillmentItemIndex: number;
  giglShipping?: ReturnType<typeof useOrderGiglShipping>;
  hasExistingFulfillment: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  // Fires once the closed sheet's modal has gone, so a dialog can present.
  onDismissed?: () => void;
  // Fires once the sheet is on screen, so whatever opened it can close
  // underneath without the dimmed background flashing off in between.
  onPresented?: () => void;
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
