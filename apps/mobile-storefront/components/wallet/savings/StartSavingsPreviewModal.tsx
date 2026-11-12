import { ModalSheet } from '@/components/ui/ModalSheet';
import { StartSavingsDoneContent } from './StartSavingsDoneContent';
import { StartSavingsReviewContent } from './StartSavingsReviewContent';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';

type Props = {
  colors: StartSavingsColors;
  controller: StartSavingsController;
};

/**
 * One sheet for the whole hand-over: review the plan and create it, then the
 * same sheet confirms it is set. There is no separate payment-method step.
 */
export function StartSavingsPreviewModal({ colors, controller }: Props) {
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
      {controller.showSuccessModal ? (
        <StartSavingsDoneContent colors={colors} controller={controller} />
      ) : (
        <StartSavingsReviewContent colors={colors} controller={controller} />
      )}
    </ModalSheet>
  );
}
