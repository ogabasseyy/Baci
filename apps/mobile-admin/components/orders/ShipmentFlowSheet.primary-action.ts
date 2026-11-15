import type { ShipmentFlowSheetProps } from './ShipmentFlowSheet.types';

type PrimaryActionInput = Pick<
  ShipmentFlowSheetProps,
  | 'canBookGigl'
  | 'canUseProvider'
  | 'externalWaybill'
  | 'giglShipping'
  | 'onConfirmSelfFulfillment'
  | 'onContinueFromDetails'
  | 'onContinueFromMethod'
  | 'selectedMode'
  | 'step'
> & {
  isRecoveryBlocking: boolean;
  /** Called when booking needs the customer's checkout destination reviewed. */
  onRecoveryRequired: () => void;
};

/** Runs the footer's primary action for the current shipment-flow step. */
export async function runShipmentFlowPrimaryAction({
  canBookGigl,
  canUseProvider,
  externalWaybill,
  giglShipping,
  isRecoveryBlocking,
  onConfirmSelfFulfillment,
  onContinueFromDetails,
  onContinueFromMethod,
  onRecoveryRequired,
  selectedMode,
  step,
}: PrimaryActionInput): Promise<void> {
  if (isRecoveryBlocking) return;
  if (step === 'details') return onContinueFromDetails();
  if (step === 'rider') return onConfirmSelfFulfillment();
  if (selectedMode === 'external_waybill') {
    if (!externalWaybill) return;
    return externalWaybill.preview?.linkable
      ? externalWaybill.link()
      : externalWaybill.check();
  }
  if (selectedMode === 'provider') {
    // Defence in depth: never start a booking the footer would not allow.
    if (giglShipping ? !canBookGigl : !canUseProvider) return;
    if (
      giglShipping &&
      !(await giglShipping.ensureFreshQuoteForConfirmation())
    ) {
      return;
    }
  }
  const outcome = await onContinueFromMethod();
  if (outcome === 'review_checkout_quote') onRecoveryRequired();
}
