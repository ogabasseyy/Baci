import type { OrderGiglExternalWaybill } from '@/hooks/orders/useOrderGiglExternalWaybill';
import type {
  ShipmentCompletionMode,
  ShipmentFlowStep,
} from '@/lib/order-shipment';
import type { ShipmentFlowSheetProps } from './ShipmentFlowSheet.types';

interface PrimaryActionInput {
  detailStepCount: number;
  externalWaybill?: OrderGiglExternalWaybill;
  fulfillmentItemIndex: number;
  hasGiglQuote: boolean;
  providerLabel: string | null;
  selectedMode: ShipmentCompletionMode;
  step: ShipmentFlowStep;
}

export function getShipmentFlowPrimaryActionLabel({
  detailStepCount,
  externalWaybill,
  fulfillmentItemIndex,
  hasGiglQuote,
  providerLabel,
  selectedMode,
  step,
}: PrimaryActionInput): string {
  if (step === 'details') {
    return fulfillmentItemIndex < detailStepCount - 1
      ? 'Next Item'
      : 'Continue';
  }
  if (step !== 'method') return 'Mark Shipped';
  if (selectedMode === 'self_fulfillment') return 'Continue to Rider';
  if (selectedMode === 'external_waybill') {
    return externalWaybill?.preview?.linkable
      ? 'Attach Waybill'
      : 'Check Waybill';
  }
  return `Book with ${providerLabel || (hasGiglQuote ? 'GIG Logistics' : 'Shipping Provider')}`;
}

export function isShipmentFlowPrimaryDisabled({
  canBookGigl,
  canUseProvider,
  externalWaybill,
  giglShipping,
  isRecoveryBlocking,
  selectedMode,
  step,
}: Pick<
  ShipmentFlowSheetProps,
  | 'canBookGigl'
  | 'canUseProvider'
  | 'externalWaybill'
  | 'giglShipping'
  | 'selectedMode'
  | 'step'
> & { isRecoveryBlocking: boolean }): boolean {
  if (isRecoveryBlocking) return true;
  if (step !== 'method') return false;
  if (selectedMode === 'external_waybill') {
    const state = externalWaybill?.state;
    return (
      !externalWaybill ||
      state === 'checking' ||
      state === 'linking' ||
      (state === 'preview' && !externalWaybill.preview?.linkable)
    );
  }
  if (selectedMode !== 'provider') return false;
  // canUseProvider already excludes GIG saved quotes the viewer may not book
  // (getOrderGiglShippingVisibility); other providers keep their own rules.
  if (!giglShipping) return !canUseProvider;
  return (
    !canBookGigl ||
    !giglShipping.wallet?.canBook ||
    giglShipping.state === 'loading' ||
    giglShipping.state === 'funding' ||
    giglShipping.state === 'funding_pending' ||
    giglShipping.state === 'polling'
  );
}
