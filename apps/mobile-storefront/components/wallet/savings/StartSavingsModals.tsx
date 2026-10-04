import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { showAppAlert } from '@/components/ui/show-app-alert';
import { BRAND } from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { createLogger } from '@/lib/logger';
import { StartSavingsPreviewModal } from './StartSavingsPreviewModal';
import { StartSavingsTransferModal } from './StartSavingsTransferModal';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';
import {
  FundingOptionCard,
  SavedPaymentMethodCard,
} from './start-savings-modal-parts';

const log = createLogger('StartSavingsModals');

type StartSavingsModalsProps = {
  colors: StartSavingsColors;
  controller: StartSavingsController;
};

function handleSavingsModalActionError({
  error,
  message,
  operation,
  title,
}: {
  error: unknown;
  message: string;
  operation: string;
  title: string;
}) {
  log.error('Savings modal action failed', { error, operation });
  showAppAlert({ title, message, variant: 'error' });
}

export function StartSavingsModals({
  colors,
  controller,
}: StartSavingsModalsProps) {
  return (
    <>
      <StartSavingsPreviewModal
        colors={colors}
        controller={controller}
        fundingContent={
          <FundingContent colors={colors} controller={controller} />
        }
      />
      <StartSavingsTransferModal colors={colors} controller={controller} />
      <SuccessModal colors={colors} controller={controller} />
    </>
  );
}

function FundingContent({ colors, controller }: StartSavingsModalsProps) {
  return (
    <>
      <Text style={[styles.modalTitle, { color: colors.text }]}>
        Payment Methods
      </Text>
      {controller.sourceMode === 'auto_debit' ? (
        <AutoDebitFundingContent colors={colors} controller={controller} />
      ) : (
        <ManualFundingContent colors={colors} controller={controller} />
      )}
      {controller.formError ? (
        <Text
          accessibilityRole="alert"
          style={[styles.errorText, { color: colors.error }]}
        >
          {controller.formError}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue funding option"
        style={[
          styles.primaryButton,
          controller.isSubmitting || controller.isAuthorizingCard
            ? styles.buttonDisabled
            : null,
        ]}
        onPress={() => {
          controller.handleFundingContinue().catch((error) => {
            handleSavingsModalActionError({
              error,
              message: 'Please try the savings funding step again.',
              operation: 'Savings funding continue',
              title: 'Unable to continue',
            });
          });
        }}
        disabled={controller.isSubmitting || controller.isAuthorizingCard}
      >
        <Text style={styles.primaryButtonText}>
          {controller.isAuthorizingCard
            ? 'Authorizing card...'
            : controller.isSubmitting
              ? 'Processing...'
              : 'Continue'}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to savings review"
        style={styles.modalCloseButton}
        onPress={() => {
          controller.setShowFundingModal(false);
          controller.setShowPreviewModal(true);
        }}
      >
        <Text style={[styles.modalCloseText, { color: colors.textSecondary }]}>
          Back to plan
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close funding options"
        style={styles.modalCloseButton}
        onPress={() => controller.setShowFundingModal(false)}
      >
        <Text style={[styles.modalCloseText, { color: colors.textSecondary }]}>
          Close
        </Text>
      </Pressable>
    </>
  );
}

function AutoDebitFundingContent({
  colors,
  controller,
}: StartSavingsModalsProps) {
  return (
    <View style={styles.savedPaymentMethodList}>
      {controller.isLoadingPaymentMethods ? (
        <ActivityIndicator
          accessibilityLabel="Loading savings payment methods"
          size="small"
          color={BRAND.primary}
        />
      ) : controller.savedPaymentMethods.length > 0 ? (
        controller.savedPaymentMethods.map((method) => (
          <SavedPaymentMethodCard
            key={method.id}
            active={controller.selectedPaymentMethodId === method.id}
            colors={colors}
            method={method}
            onPress={() => {
              controller.setSelectedPaymentMethodId(method.id);
              controller.setPaymentMethodsError(null);
            }}
          />
        ))
      ) : (
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          No saved cards yet.
        </Text>
      )}
      {controller.paymentMethodsError ? (
        <Text style={[styles.errorText, { color: colors.error }]}>
          {controller.paymentMethodsError}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add savings card"
        style={[
          styles.outlineButton,
          { borderColor: colors.border },
          controller.isAuthorizingCard ? styles.buttonDisabled : null,
        ]}
        onPress={() => {
          controller.handleAuthorizeSavingsCard().catch((error) => {
            handleSavingsModalActionError({
              error,
              message: 'Please try adding your card again.',
              operation: 'Savings card authorization',
              title: 'Unable to add card',
            });
          });
        }}
        disabled={controller.isAuthorizingCard}
      >
        <Text style={[styles.outlineButtonText, { color: colors.text }]}>
          {controller.isAuthorizingCard
            ? 'Opening secure checkout…'
            : 'Add card'}
        </Text>
      </Pressable>
    </View>
  );
}

function ManualFundingContent({ colors, controller }: StartSavingsModalsProps) {
  return (
    <View style={styles.fundingOptionRow}>
      <FundingOptionCard
        active={controller.selectedFundingOption === 'wallet'}
        description={`Use available wallet balance (${formatNgnCurrency(controller.safeWalletBalance)}) for your initial contribution.`}
        label="Pay with wallet balance"
        onPress={() => controller.setSelectedFundingOption('wallet')}
        colors={colors}
      />
      <FundingOptionCard
        active={controller.selectedFundingOption === 'bank_transfer'}
        description="Show your dedicated account number and create the plan after wallet funding lands."
        label="Pay with bank transfer"
        onPress={() => controller.setSelectedFundingOption('bank_transfer')}
        colors={colors}
      />
    </View>
  );
}

function SuccessModal({ colors, controller }: StartSavingsModalsProps) {
  return (
    <ModalSheet
      visible={controller.showSuccessModal}
      animationType="fade"
      backdropStyle={styles.modalBackdrop}
      cardStyle={[styles.modalCard, { backgroundColor: colors.background }]}
    >
      <View style={styles.successIconWrap}>
        <Ionicons name="checkmark" size={28} color={BRAND.primary} />
      </View>
      <Text
        style={[styles.modalTitle, { color: colors.text, textAlign: 'center' }]}
      >
        Savings plan created successfully
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go to wallet"
        style={styles.primaryButton}
        onPress={controller.goToWallet}
      >
        <Text style={styles.primaryButtonText}>Go to Wallet</Text>
      </Pressable>
    </ModalSheet>
  );
}
