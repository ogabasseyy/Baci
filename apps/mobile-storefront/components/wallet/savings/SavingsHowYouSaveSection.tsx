import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import { SavingsChoiceCards } from './SavingsChoiceCards';
import { SavingsIconLabel } from './SavingsIconLabel';
import { EARLY_CANCEL_INTEREST_NOTE } from './savings-interest-copy';
import { startSavingsStyles as styles } from './start-savings.styles';
import type {
  SavingsSourceMode,
  StartSavingsColors,
} from './start-savings.types';
import type { StartSavingsController } from './start-savings-controller.types';

type Props = { colors: StartSavingsColors; controller: StartSavingsController };

/** Step 3's one line under its title: how the money goes in. */
export function howYouSaveLine(sourceMode: SavingsSourceMode) {
  return sourceMode === 'auto_debit'
    ? 'We’ll charge your saved card on saving days.'
    : 'Add from your wallet anytime. We’ll remind you on saving days.';
}

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
  {
    value: true,
    label: 'Yes, grow it',
    accessibilityLabel: 'Yes, earn interest',
    icon: 'trending-up-outline',
  },
  {
    value: false,
    label: 'No, savings only',
    accessibilityLabel: 'No, do not earn interest',
    icon: 'shield-checkmark-outline',
  },
] as const;

/** Step 3: how the money goes in, the interest answer and the terms. */
export function SavingsHowYouSaveSection({ colors, controller }: Props) {
  const hosted = process.env.EXPO_PUBLIC_HOSTED_STOREFRONT === '1';
  // PiggyVest wallets save manually only: no card money goes into PiggyVest.
  const offerAutoDebit = controller.allowAutoDebit && !hosted;
  return (
    <View style={styles.roomyBlocks}>
      {offerAutoDebit ? (
        <SavingsChoiceCards<SavingsSourceMode>
          accessibilityLabel="Savings source of funds"
          colors={colors}
          options={SOURCE_OPTIONS}
          selected={controller.sourceMode}
          onSelect={controller.handleSourceModeChange}
        />
      ) : null}
      {controller.askInterest ? (
        <View style={styles.section}>
          <SavingsIconLabel
            icon="sparkles-outline"
            text="Earn interest on your savings?"
            color={colors.text}
          />
          <Text style={[styles.subheading, { color: colors.textSecondary }]}>
            Grow your money while you save.
          </Text>
          <SavingsChoiceCards
            accessibilityLabel="Earn interest on your savings"
            colors={colors}
            options={INTEREST_OPTIONS}
            selected={controller.interestChoice}
            onSelect={controller.setInterestChoice}
          />
          <SavingsIconLabel
            icon="information-circle-outline"
            text={EARLY_CANCEL_INTEREST_NOTE}
            color={colors.textSecondary}
            variant="note"
          />
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
      <Ionicons
        name="shield-checkmark-outline"
        size={16}
        color={BRAND.primary}
        style={styles.checkboxIcon}
      />
      <Text style={[styles.checkboxLabel, { color: colors.textSecondary }]}>
        I understand this money is kept for the phone I picked and can’t be
        withdrawn to a bank account.
      </Text>
    </Pressable>
  );
}
