import { Pressable, Text, View } from 'react-native';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { StartSavingsAutoDebitFundingContent } from './StartSavingsAutoDebitFundingContent';
import { StartSavingsManualFundingContent } from './StartSavingsManualFundingContent';
import { StartSavingsReviewPlan } from './StartSavingsReviewPlan';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';
import { handleSavingsModalActionError } from './start-savings-modal-action-error';

type Props = {
  colors: StartSavingsColors;
  controller: StartSavingsController;
};

/**
 * The one review step: the plan at a glance, the funding choice only where
 * there is a real choice to make (a head start on the old wallet, or the
 * card for auto debit), and a single button that creates the plan.
 */
export function StartSavingsReviewContent({ colors, controller }: Props) {
  const headStart =
    controller.sourceMode === 'auto_debit'
      ? 0
      : controller.effectiveInitialContribution;
  // Never ask how to pay for nothing, and PiggyVest head starts move from
  // the wallet after the plan exists.
  const chooseHeadStartFunding =
    controller.sourceMode === 'manual' &&
    !controller.primaryWallet &&
    headStart > 0;
  const busy = controller.isSubmitting || controller.isAuthorizingCard;
  return (
    <>
      <View style={styles.sheetHandle} />
      <Text style={[styles.reviewEyebrow, { color: colors.textSecondary }]}>
        Check your plan
      </Text>
      <StartSavingsReviewPlan colors={colors} controller={controller} />
      {headStart > 0 ? (
        <Text style={[styles.subheading, { color: colors.textSecondary }]}>
          Head start: {formatNgnCurrency(headStart)}
        </Text>
      ) : null}
      {chooseHeadStartFunding ? (
        <>
          <Text style={[styles.sectionLabel, { color: colors.text }]}>
            Pay your head start with
          </Text>
          <StartSavingsManualFundingContent
            colors={colors}
            controller={controller}
          />
        </>
      ) : null}
      {controller.sourceMode === 'auto_debit' ? (
        <>
          <Text style={[styles.sectionLabel, { color: colors.text }]}>
            Card for automatic saving
          </Text>
          <StartSavingsAutoDebitFundingContent
            colors={colors}
            controller={controller}
          />
        </>
      ) : null}
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
        accessibilityLabel="Create my plan"
        accessibilityState={{ disabled: busy, busy }}
        style={[styles.primaryButton, busy ? styles.buttonDisabled : null]}
        onPress={() => {
          controller.handleFundingContinue().catch((error) => {
            handleSavingsModalActionError({
              error,
              message: 'Please try creating your plan again.',
              operation: 'Savings plan create',
              title: 'Unable to create plan',
            });
          });
        }}
        disabled={busy}
      >
        <Text style={styles.primaryButtonText}>
          {controller.isAuthorizingCard
            ? 'Adding your card…'
            : controller.isSubmitting
              ? 'Creating your plan…'
              : 'Create my plan'}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Edit plan"
        style={styles.modalCloseButton}
        onPress={() => {
          controller.setShowPreviewModal(false);
          controller.setShowFundingModal(false);
        }}
        disabled={controller.isSubmitting}
      >
        <Text style={[styles.modalCloseText, { color: colors.textSecondary }]}>
          Edit plan
        </Text>
      </Pressable>
    </>
  );
}
