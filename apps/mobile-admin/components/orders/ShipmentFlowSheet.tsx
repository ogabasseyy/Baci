import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareModalContainer } from '@/components/ui/KeyboardAwareModalContainer';
import { isRuntimePlatform } from '@/config/runtime-platform';
import type { useOrderGiglShipping } from '@/hooks/orders/useOrderGiglShipping';
import { useTheme } from '@/hooks/useTheme';
import type {
  ShipmentCompletionMode,
  ShipmentFlowStep,
  ShipmentFulfillmentDetails,
} from '@/lib/order-shipment';
import { ShipmentFlowFooter } from './ShipmentFlowFooter';
import { ShipmentFlowGiglPanel } from './ShipmentFlowGiglPanel';
import { ShipmentFlowHeader } from './ShipmentFlowHeader';
import { ShipmentFlowProgress } from './ShipmentFlowProgress';
import { styles } from './ShipmentFlowSheet.styles';
import {
  ShipmentFlowDetailsStep,
  ShipmentFlowMethodStep,
  ShipmentFlowRiderStep,
} from './ShipmentFlowSheetSections';
import { ShipmentIdentifierScanner } from './ShipmentIdentifierScanner';

// With behavior="padding", a larger keyboardVerticalOffset lifts the sheet
// HIGHER above the keyboard. Keep iOS at 0 so the sheet rests directly on top
// of the keyboard (breathing room comes from the content's bottom padding).
const IOS_SHIPMENT_KEYBOARD_VERTICAL_OFFSET = 0;
const DEFAULT_SHIPMENT_KEYBOARD_VERTICAL_OFFSET = 24;

interface ShipmentFlowSheetProps {
  canUseProvider: boolean;
  fulfillmentDetails: ShipmentFulfillmentDetails;
  fulfillmentItemIndex: number;
  giglShipping?: ReturnType<typeof useOrderGiglShipping>;
  hasExistingFulfillment: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onContinueFromDetails: () => void;
  onContinueFromMethod: () => void;
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

export function ShipmentFlowSheet({
  canUseProvider,
  fulfillmentDetails,
  fulfillmentItemIndex,
  giglShipping,
  hasExistingFulfillment,
  isSubmitting,
  onClose,
  onContinueFromDetails,
  onContinueFromMethod,
  onConfirmSelfFulfillment,
  onFulfillmentDetailsChange,
  onModeChange,
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
  const primaryActionLabel =
    step === 'details'
      ? fulfillmentItemIndex < detailStepCount - 1
        ? 'Next Item'
        : 'Continue'
      : step === 'method'
        ? selectedMode === 'self_fulfillment'
          ? 'Continue to Rider'
          : `Book with ${providerLabel || (giglShipping?.quote ? 'GIG Logistics' : 'Shipping Provider')}`
        : 'Mark Shipped';

  useEffect(() => {
    if (!visible) {
      setActiveScanField(null);
    }
  }, [visible]);

  if (!visible) {
    return null;
  }

  const handleRequestClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  const handleBack = () => {
    if (isSubmitting) return;
    onStepBack();
  };

  const handlePrimaryAction = async () => {
    if (step === 'details') return onContinueFromDetails();
    if (step === 'rider') return onConfirmSelfFulfillment();
    if (
      selectedMode === 'provider' &&
      giglShipping &&
      !(await giglShipping.ensureFreshQuoteForConfirmation())
    ) {
      return;
    }
    onContinueFromMethod();
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={handleRequestClose}
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <View style={styles.backdrop} />
        <KeyboardAwareModalContainer
          align="end"
          contentContainerStyle={styles.keyboardContent}
          keyboardVerticalOffset={keyboardVerticalOffset}
        >
          <Pressable
            accessibilityLabel="Cancel shipment flow"
            accessibilityRole="button"
            accessibilityState={{ disabled: isSubmitting }}
            disabled={isSubmitting}
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
              isSubmitting={isSubmitting}
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
                  canUseProvider={canUseProvider}
                  giglPanel={
                    !giglShipping ? undefined : (
                      <ShipmentFlowGiglPanel
                        addressDraft={giglShipping.addressDraft}
                        error={giglShipping.error}
                        fundingAccount={giglShipping.fundingAccount}
                        missingFields={giglShipping.missingFields}
                        onAddressFieldChange={giglShipping.updateAddressField}
                        onFundWallet={() => void giglShipping.startFunding()}
                        onRefreshFundingAccount={() =>
                          void giglShipping.refreshFundingAccount()
                        }
                        onModeChange={() => onModeChange('provider')}
                        onRetryQuote={() => void giglShipping.requestQuote()}
                        onTransferred={giglShipping.startTransferPoll}
                        quote={giglShipping.quote}
                        selected={selectedMode === 'provider'}
                        state={giglShipping.state}
                        wallet={giglShipping.wallet}
                      />
                    )
                  }
                  onModeChange={onModeChange}
                  providerLabel={providerLabel}
                  selectedMode={selectedMode}
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
              isSubmitting={isSubmitting}
              isPrimaryDisabled={
                step === 'method' &&
                selectedMode === 'provider' &&
                (giglShipping
                  ? !giglShipping.wallet?.canBook ||
                    giglShipping.state === 'loading' ||
                    giglShipping.state === 'funding' ||
                    giglShipping.state === 'funding_pending' ||
                    giglShipping.state === 'polling'
                  : !canUseProvider)
              }
              onBack={handleBack}
              onPrimaryAction={() => void handlePrimaryAction()}
              primaryActionLabel={primaryActionLabel}
              selectedMode={selectedMode}
              showBack={showBack}
              step={step}
            />
          </View>
        </KeyboardAwareModalContainer>
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
      </View>
    </Modal>
  );
}
