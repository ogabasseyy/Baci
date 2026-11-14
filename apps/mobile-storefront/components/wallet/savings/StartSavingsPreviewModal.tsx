import { ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { SPACING } from '@/constants/Colors';
import { StartSavingsDoneContent } from './StartSavingsDoneContent';
import { StartSavingsReviewContent } from './StartSavingsReviewContent';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';

type Props = {
  colors: StartSavingsColors;
  controller: StartSavingsController;
};

/** The sheet never grows past this share of the screen; the rest scrolls. */
export const REVIEW_SHEET_MAX_HEIGHT_RATIO = 0.85;

/**
 * One sheet for the whole hand-over: review the plan and create it, then the
 * same sheet confirms it is set. There is no separate payment-method step.
 * Its content scrolls, so many saved cards, a small screen or large text
 * never push the plan summary or a card out of reach.
 */
export function StartSavingsPreviewModal({ colors, controller }: Props) {
  const { height } = useWindowDimensions();
  return (
    <ModalSheet
      visible={
        controller.showPreviewModal ||
        controller.showFundingModal ||
        controller.showSuccessModal
      }
      animationType="slide"
      backdropStyle={styles.modalBackdrop}
      cardStyle={[styles.modalCard, { backgroundColor: colors.background }]}
    >
      <ScrollView
        testID="start-savings-review-scroll"
        style={{ maxHeight: height * REVIEW_SHEET_MAX_HEIGHT_RATIO }}
        contentContainerStyle={localStyles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {controller.showSuccessModal ? (
          <StartSavingsDoneContent colors={colors} controller={controller} />
        ) : (
          <StartSavingsReviewContent colors={colors} controller={controller} />
        )}
      </ScrollView>
    </ModalSheet>
  );
}

const localStyles = StyleSheet.create({
  content: { gap: SPACING.sm },
});
