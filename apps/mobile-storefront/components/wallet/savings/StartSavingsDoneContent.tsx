import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { formatDateTimeDisplay } from '@/components/ui/format-date-time-display';
import { BRAND } from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { savingsPaceWords } from './savings-pace-words';
import { startSavingsStyles as styles } from './start-savings.styles';
import type { StartSavingsColors } from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';

type Props = {
  colors: StartSavingsColors;
  controller: StartSavingsController;
};

/**
 * Shown in the same sheet once the plan is created. Honest about money: with
 * no head start nothing has been saved yet, so it says what comes next
 * instead of congratulating a ₦0 start.
 */
export function StartSavingsDoneContent({ colors, controller }: Props) {
  const pace = `${formatNgnCurrency(controller.contributionValue)} ${savingsPaceWords(controller.frequency)}`;
  const headStart =
    controller.sourceMode === 'auto_debit'
      ? 0
      : controller.effectiveInitialContribution;
  const startsOn = formatDateTimeDisplay(controller.startDate, 'date');
  const message =
    headStart > 0 && headStart >= controller.targetValue
      ? `Your ${formatNgnCurrency(headStart)} head start covers the whole phone. Your plan is complete.`
      : controller.sourceMode === 'auto_debit'
        ? `Nothing has been taken yet. We’ll charge your saved card ${pace} from ${startsOn}.`
        : headStart > 0
          ? `Your ${formatNgnCurrency(headStart)} head start is in. Next, save ${pace}.`
          : `Nothing has been taken yet. Save ${pace} from ${startsOn}, from your wallet.`;
  return (
    <>
      <View style={styles.successIconWrap}>
        <Ionicons name="checkmark" size={28} color={BRAND.primary} />
      </View>
      <Text
        accessibilityRole="header"
        style={[styles.modalTitle, { color: colors.text, textAlign: 'center' }]}
      >
        Your plan is set
      </Text>
      <Text style={[styles.doneBody, { color: colors.textSecondary }]}>
        {message}
      </Text>
      {controller.primaryWallet ? (
        <Text style={[styles.doneBody, { color: colors.textSecondary }]}>
          We’re getting it ready in your wallet. It usually takes about a
          minute.
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go to wallet"
        style={styles.primaryButton}
        onPress={controller.goToWallet}
      >
        <Text style={styles.primaryButtonText}>Go to wallet</Text>
      </Pressable>
    </>
  );
}
