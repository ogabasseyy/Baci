import { Pressable, Text } from 'react-native';
import { StartSavingsAutoDebitFundingContent } from './StartSavingsAutoDebitFundingContent';
import { StartSavingsManualFundingContent } from './StartSavingsManualFundingContent';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';
import { handleSavingsModalActionError } from './start-savings-modal-action-error';

type Props = {
  colors: StartSavingsColors;
  controller: StartSavingsController;
};

export function StartSavingsFundingContent({ colors, controller }: Props) {
  return (
    <>
      <Text style={[styles.modalTitle, { color: colors.text }]}>
        Payment Methods
      </Text>
      {controller.sourceMode === 'auto_debit' ? (
        <StartSavingsAutoDebitFundingContent
          colors={colors}
          controller={controller}
        />
      ) : (
        <StartSavingsManualFundingContent
          colors={colors}
          controller={controller}
        />
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
