import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareModalContainer } from '@/components/ui/KeyboardAwareModalContainer';
import { isRuntimePlatform } from '@/config/runtime-platform';
import { useTheme } from '@/hooks/useTheme';
import { CheckoutShippingRecoveryPanel } from './CheckoutShippingRecoveryPanel';
import { ShipmentFlowFooter } from './ShipmentFlowFooter';
import { ShipmentFlowGiglPanel } from './ShipmentFlowGiglPanel';
import { ShipmentFlowHeader } from './ShipmentFlowHeader';
import { ShipmentFlowProgress } from './ShipmentFlowProgress';
import {
  getShipmentFlowPrimaryActionLabel,
  isShipmentFlowPrimaryDisabled,
} from './ShipmentFlowSheet.actions';
import { runShipmentFlowPrimaryAction } from './ShipmentFlowSheet.primary-action';
import { styles } from './ShipmentFlowSheet.styles';
import type { ShipmentFlowSheetProps } from './ShipmentFlowSheet.types';
import { ShipmentFlowSheetPresence } from './ShipmentFlowSheetPresence';
import {
  ShipmentFlowDetailsStep,
  ShipmentFlowMethodStep,
  ShipmentFlowRiderStep,
} from './ShipmentFlowSheetSections';
import { ShipmentIdentifierScanner } from './ShipmentIdentifierScanner';

const IOS_SHIPMENT_KEYBOARD_VERTICAL_OFFSET = 0;
const DEFAULT_SHIPMENT_KEYBOARD_VERTICAL_OFFSET = 24;
export function ShipmentFlowSheet({
  recoveryOrder,
  canBookGigl,
  canUseProvider,
  isGiglOrder = false,
  checkoutPaidShippingLabel,
  externalWaybill,
  fulfillmentDetails,
  fulfillmentItemIndex,
  giglShipping,
  hasExistingFulfillment,
  isSubmitting,
  onClose,
  onContinueFromDetails,
  onContinueFromMethod,
  onConfirmSelfFulfillment,
  onDismissed,
  onFulfillmentDetailsChange,
  onModeChange,
  onPresented,
  onRiderPhoneChange,
  onSelectSavedRider,
  onStepBack,
  orderNumber,
  providerLabel,
  requiresFulfillment,
  riderPhone,
  savedRiders,
  selectedMode,
  step,
  visible,
}: ShipmentFlowSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [recoveryRequiredOrderId, setRecoveryRequiredOrderId] = useState<
    string | null
  >(null);
  const recoveryRequired = Boolean(
    recoveryOrder && recoveryRequiredOrderId === recoveryOrder.id
  );
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);
  const [recoveryBlocking, setRecoveryBlocking] = useState(false);
  const isRecoveryBlocking =
    step === 'method' &&
    (recoveryRequired ? selectedMode === 'provider' : recoveryBlocking);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const isBusy =
    isSubmitting ||
    recoveryBusy ||
    externalWaybill?.state === 'checking' ||
    externalWaybill?.state === 'linking';
  const [activeScanField, setActiveScanField] = useState<
    'imei' | 'serialNumber' | null
  >(null);
  const keyboardVerticalOffset = isRuntimePlatform('ios')
    ? IOS_SHIPMENT_KEYBOARD_VERTICAL_OFFSET
    : DEFAULT_SHIPMENT_KEYBOARD_VERTICAL_OFFSET;
  const detailStepCount = requiresFulfillment
    ? Math.max(fulfillmentDetails.items.length, 1)
    : 0;
  const detailSteps = Array.from({ length: detailStepCount }, (_, index) => ({
    id: `details-${index}`,
    label: detailStepCount > 1 ? `Item ${index + 1}` : 'Details',
  }));
  const steps = [
    ...detailSteps,
    { id: 'method', label: 'Shipping' },
    { id: 'rider', label: 'Dispatch' },
  ];
  const currentStepIndex =
    step === 'details'
      ? Math.min(fulfillmentItemIndex, Math.max(detailStepCount - 1, 0))
      : detailStepCount +
        steps.slice(detailStepCount).findIndex((item) => item.id === step);
  const showBack = currentStepIndex > 0;
  const primaryActionLabel = getShipmentFlowPrimaryActionLabel({
    detailStepCount,
    externalWaybill,
    fulfillmentItemIndex,
    hasGiglQuote: Boolean(giglShipping?.quote),
    providerLabel,
    selectedMode,
    step,
  });
  useEffect(() => {
    if (!visible) {
      setActiveScanField(null);
    }
  }, [visible]);
  const handleRequestClose = () => {
    if (isBusy) return;
    onClose();
  };
  const handleBack = () => {
    if (isBusy) return;
    onStepBack();
  };
  const handlePrimaryAction = () =>
    runShipmentFlowPrimaryAction({
      canBookGigl,
      canUseProvider,
      externalWaybill,
      giglShipping,
      isRecoveryBlocking,
      onConfirmSelfFulfillment,
      onContinueFromDetails,
      onContinueFromMethod,
      onRecoveryRequired: () => {
        if (!recoveryOrder) return;
        setRecoveryAttempt((attempt) => attempt + 1);
        setRecoveryRequiredOrderId(recoveryOrder.id);
      },
      selectedMode,
      step,
    });
  return (
    <ShipmentFlowSheetPresence
      accessory={
        <ShipmentIdentifierScanner
          colors={colors}
          field={activeScanField ?? 'imei'}
          onClose={() => setActiveScanField(null)}
          onScanned={(value) => {
            if (activeScanField) {
              onFulfillmentDetailsChange(activeScanField, value);
            }
            setActiveScanField(null);
          }}
          visible={activeScanField !== null}
        />
      }
      onDismissed={onDismissed}
      onRequestClose={handleRequestClose}
      onShow={onPresented}
      visible={visible}
    >
      <KeyboardAwareModalContainer
        align="end"
        contentContainerStyle={styles.keyboardContent}
        keyboardVerticalOffset={keyboardVerticalOffset}
      >
        <Pressable
          accessibilityLabel="Cancel shipment flow"
          accessibilityRole="button"
          accessibilityState={{ disabled: isBusy }}
          disabled={isBusy}
          onPress={handleRequestClose}
          style={styles.dismissRegion}
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          <ShipmentFlowHeader
            colors={colors}
            isSubmitting={isBusy}
            onClose={handleRequestClose}
            orderNumber={orderNumber}
            step={step}
          />
          <ShipmentFlowProgress
            colors={colors}
            currentStepIndex={currentStepIndex}
            steps={steps}
          />
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.content}
          >
            {step === 'details' ? (
              <ShipmentFlowDetailsStep
                fulfillmentDetails={fulfillmentDetails}
                fulfillmentItemIndex={fulfillmentItemIndex}
                hasExistingFulfillment={hasExistingFulfillment}
                onFulfillmentDetailsChange={onFulfillmentDetailsChange}
                onScanIdentifier={setActiveScanField}
              />
            ) : null}
            {step === 'method' ? (
              <ShipmentFlowMethodStep
                bookingDenied={isGiglOrder && !canBookGigl}
                canUseProvider={canUseProvider}
                checkoutPaidShippingLabel={checkoutPaidShippingLabel}
                externalWaybill={externalWaybill}
                giglPanel={
                  !giglShipping ? undefined : (
                    <ShipmentFlowGiglPanel
                      addressDraft={giglShipping.addressDraft}
                      bookingAllowed={canBookGigl}
                      error={giglShipping.error}
                      fundingAccount={giglShipping.fundingAccount}
                      missingFields={giglShipping.missingFields}
                      onAddressFieldChange={giglShipping.updateAddressField}
                      onFundWallet={() => void giglShipping.startFunding()}
                      onPlaceSelect={giglShipping.selectAddressPlace}
                      onRefreshFundingAccount={() =>
                        void giglShipping.refreshFundingAccount()
                      }
                      onModeChange={() => !isBusy && onModeChange('provider')}
                      onRetryQuote={() => void giglShipping.requestQuote()}
                      onTransferred={giglShipping.startTransferPoll}
                      quote={giglShipping.quote}
                      selected={selectedMode === 'provider'}
                      state={giglShipping.state}
                      wallet={giglShipping.wallet}
                    />
                  )
                }
                onModeChange={(mode) => !isBusy && onModeChange(mode)}
                providerLabel={providerLabel}
                selectedMode={selectedMode}
              />
            ) : null}
            {step === 'method' &&
            !isSubmitting &&
            recoveryOrder &&
            (!recoveryRequired || selectedMode === 'provider') ? (
              <CheckoutShippingRecoveryPanel
                key={`${recoveryOrder.id}:${recoveryAttempt}`}
                canRecover={canBookGigl}
                order={recoveryOrder}
                required={recoveryRequired}
                onConfirmed={() => setRecoveryRequiredOrderId(null)}
                onBlockingChange={setRecoveryBlocking}
                onBusyChange={setRecoveryBusy}
              />
            ) : null}
            {step === 'rider' ? (
              <ShipmentFlowRiderStep
                onRiderPhoneChange={onRiderPhoneChange}
                onSelectSavedRider={onSelectSavedRider}
                riderPhone={riderPhone}
                savedRiders={savedRiders}
              />
            ) : null}
          </ScrollView>
          <ShipmentFlowFooter
            colors={colors}
            isSubmitting={isBusy}
            isPrimaryDisabled={isShipmentFlowPrimaryDisabled({
              canBookGigl,
              canUseProvider,
              externalWaybill,
              giglShipping,
              isRecoveryBlocking,
              selectedMode,
              step,
            })}
            onBack={handleBack}
            onPrimaryAction={() => void handlePrimaryAction()}
            primaryActionLabel={primaryActionLabel}
            selectedMode={selectedMode}
            showBack={showBack}
            step={step}
          />
        </View>
      </KeyboardAwareModalContainer>
    </ShipmentFlowSheetPresence>
  );
}
