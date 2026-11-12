import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { SavingsChoiceCards } from './SavingsChoiceCards';
import { startSavingsStyles as styles } from './start-savings.styles';
import type {
  SavingsSourceMode,
  StartSavingsColors,
} from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';

type Props = { colors: StartSavingsColors; controller: StartSavingsController };

const MANUAL_HINT =
  'You add money from your wallet whenever you like. We’ll remind you on your saving days.';
const AUTO_HINT =
  'We’ll charge your saved card automatically on your saving days.';

const SOURCE_OPTIONS = [
  {
    value: 'manual',
    label: 'Manual',
    accessibilityLabel: 'Use manual debit for savings',
  },
  {
    value: 'auto_debit',
    label: 'Auto debit',
    accessibilityLabel: 'Use auto debit for savings',
  },
] as const;

const INTEREST_OPTIONS = [
  { value: true, label: 'Yes', accessibilityLabel: 'Yes, earn interest' },
  { value: false, label: 'No', accessibilityLabel: 'No, do not earn interest' },
] as const;

/** Step 3: how the money goes in, the interest answer and the terms. */
export function SavingsHowYouSaveSection({ colors, controller }: Props) {
  const hosted = process.env.EXPO_PUBLIC_HOSTED_STOREFRONT === '1';
  // PiggyVest wallets save manually only: no card money goes into PiggyVest.
  const offerAutoDebit = controller.allowAutoDebit && !hosted;
  return (
    <View style={styles.section}>
      {offerAutoDebit ? (
        <SavingsChoiceCards<SavingsSourceMode>
          accessibilityLabel="Savings source of funds"
          colors={colors}
          options={SOURCE_OPTIONS}
          selected={controller.sourceMode}
          onSelect={controller.handleSourceModeChange}
        />
      ) : null}
      <Text style={[styles.sourceModeHint, { color: colors.textSecondary }]}>
        {controller.sourceMode === 'auto_debit' ? AUTO_HINT : MANUAL_HINT}
      </Text>
      {controller.askInterest ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.text }]}>
            Earn interest on your savings?
          </Text>
          <SavingsChoiceCards
            accessibilityLabel="Earn interest on your savings"
            colors={colors}
            options={INTEREST_OPTIONS}
            selected={controller.interestChoice}
            onSelect={controller.setInterestChoice}
          />
          <Text
            style={[styles.sourceModeHint, { color: colors.textSecondary }]}
          >
            You can only choose this once for this plan.
          </Text>
        </View>
      ) : null}
      <SavingsTerms colors={colors} controller={controller} />
    </View>
  );
}

function SavingsTerms({ colors, controller }: Props) {
  const checked = controller.acceptsNonWithdrawableTerms;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel="Accept non-withdrawable savings terms"
      onPress={() =>
        controller.setAcceptsNonWithdrawableTerms((value) => !value)
      }
      style={styles.checkbox}
    >
      <View
        style={[
          styles.checkboxMark,
          {
            borderColor: checked ? BRAND.primary : colors.border,
            backgroundColor: checked ? BRAND.primary : colors.card,
          },
        ]}
      >
        {checked ? (
          <Ionicons name="checkmark" size={12} color={palette.white} />
        ) : null}
      </View>
      <Text style={[styles.checkboxLabel, { color: colors.textSecondary }]}>
        I understand this money is kept for the phone I picked and can’t be
        withdrawn to a bank account.
      </Text>
    </Pressable>
  );
}
