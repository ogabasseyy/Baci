import Ionicons from '@react-native-vector-icons/ionicons';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type Colors from '@/constants/Colors';
import { isHostedStagingWalletTopUpBlocked } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import {
  WALLET_TOP_UP_MAX_AMOUNT,
  WALLET_TOP_UP_MIN_AMOUNT,
} from '@/lib/wallet-top-up-constants';

type WalletColors = (typeof Colors)['light'];

interface WalletCardTopUpFormProps {
  colors: WalletColors;
  fundAmount: string;
  isFundPending: boolean;
  onChangeFundAmount: (value: string) => void;
  onConfirmFund: () => void;
  /** Line under "Pay with card"; defaults to the wallet top-up copy. */
  subtitle?: string;
}

export function WalletCardTopUpForm({
  colors,
  fundAmount,
  isFundPending,
  onChangeFundAmount,
  onConfirmFund,
  subtitle = 'Add money securely to your wallet',
}: WalletCardTopUpFormProps) {
  const previewBlocked = isHostedStagingWalletTopUpBlocked();
  const amount = Number(fundAmount);
  const disabled =
    isFundPending ||
    previewBlocked ||
    !Number.isFinite(amount) ||
    amount < WALLET_TOP_UP_MIN_AMOUNT ||
    amount > WALLET_TOP_UP_MAX_AMOUNT;

  return (
    <View style={[styles.section, { borderColor: colors.border }]}>
      <View style={styles.headingRow}>
        <View style={[styles.icon, { backgroundColor: colors.muted }]}>
          <Ionicons name="card-outline" size={22} color={colors.primary} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Pay with card
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {subtitle}
          </Text>
        </View>
      </View>

      <Text style={[styles.label, { color: colors.textSecondary }]}>
        AMOUNT TO ADD
      </Text>
      <View
        style={[
          styles.amountField,
          { backgroundColor: colors.muted, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.currency, { color: colors.text }]}>₦</Text>
        <TextInput
          accessibilityLabel="Wallet top-up amount"
          value={fundAmount
            .replace(/[^\d]/g, '')
            .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
          onChangeText={(value) =>
            onChangeFundAmount(value.replace(/[^\d]/g, ''))
          }
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor={colors.placeholder}
          selectionColor={colors.primary}
          style={[styles.amountInput, { color: colors.text }]}
        />
      </View>
      <Text style={[styles.minimum, { color: colors.textSecondary }]}>
        Minimum ₦{WALLET_TOP_UP_MIN_AMOUNT}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue to payment"
        accessibilityState={{ disabled, busy: isFundPending }}
        disabled={disabled}
        onPress={onConfirmFund}
        style={[
          styles.continueButton,
          { backgroundColor: colors.primary, opacity: disabled ? 0.5 : 1 },
        ]}
      >
        {isFundPending ? (
          <ActivityIndicator color={colors.primaryForeground} size="small" />
        ) : (
          <>
            <Text
              style={[styles.continueText, { color: colors.primaryForeground }]}
            >
              Continue to payment
            </Text>
            <Ionicons
              name="arrow-forward"
              size={19}
              color={colors.primaryForeground}
            />
          </>
        )}
      </Pressable>
      {previewBlocked ? (
        <Text style={[styles.notice, { color: colors.textSecondary }]}>
          Card top-ups are unavailable in this hosted staging preview.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderTopWidth: 1, marginTop: 20, paddingTop: 20 },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  icon: {
    alignItems: 'center',
    borderRadius: 14,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  headingCopy: { flex: 1, gap: 3 },
  title: { fontSize: 15, fontWeight: '700' },
  subtitle: { fontSize: 12, lineHeight: 18 },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  amountField: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 60,
    paddingHorizontal: 18,
  },
  currency: { fontSize: 24, fontWeight: '700', marginRight: 10 },
  amountInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: '700',
    minWidth: 0,
    paddingVertical: 8,
  },
  minimum: { fontSize: 11, marginTop: 9 },
  continueButton: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    minHeight: 48,
    marginTop: 24,
    paddingHorizontal: 18,
  },
  continueText: { fontSize: 14, fontWeight: '700' },
  notice: { fontSize: 12, lineHeight: 19, marginTop: 12, textAlign: 'center' },
});
