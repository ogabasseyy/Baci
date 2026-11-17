import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BRAND } from '@/constants/Colors';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import type { WalletFundingAccount } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import type { StartSavingsColors } from './start-savings.types';

type Props = {
  colors: StartSavingsColors;
  /** Whole naira the head start will move. */
  headStart: number;
  /** The wallet's spendable balance in naira. */
  walletBalance: number;
  /** The wallet's own account number, for a top-up when it is short. */
  fundingAccount: WalletFundingAccount | null;
  payNow: boolean;
  disabled: boolean;
  onPayNowChange: (payNow: boolean) => void;
};

/**
 * PiggyVest head start on the review step. Ticked, it moves from the wallet
 * as soon as the plan is ready (the customer only confirms their PIN), so
 * there is no separate amount screen. When the wallet holds less than the
 * head start, the wallet's account number shows here so the customer can top
 * up first, or untick to add the head start later.
 */
export function PrimaryHeadStartChoice({
  colors,
  headStart,
  walletBalance,
  fundingAccount,
  payNow,
  disabled,
  onPayNowChange,
}: Props) {
  const short = walletBalance < headStart;
  const { copyToClipboard, feedback } = useCopyToClipboard();
  return (
    <View style={[styles.card, { borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: payNow, disabled }}
        accessibilityLabel={`Pay ${formatNgnCurrency(headStart)} head start now from my wallet`}
        disabled={disabled}
        onPress={() => onPayNowChange(!payNow)}
        style={styles.row}
      >
        <Ionicons
          name={payNow ? 'checkbox' : 'square-outline'}
          size={22}
          color={payNow ? BRAND.primary : colors.textSecondary}
        />
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Pay {formatNgnCurrency(headStart)} now from my wallet
          </Text>
          <Text style={[styles.note, { color: colors.textSecondary }]}>
            {payNow
              ? `${formatNgnCurrency(walletBalance)} available. You'll confirm with your PIN once your plan is ready.`
              : 'You can add it later from your wallet.'}
          </Text>
        </View>
      </Pressable>
      {payNow && short ? (
        <View style={[styles.topUp, { borderColor: colors.border }]}>
          <Text
            accessibilityRole="alert"
            style={[styles.note, { color: colors.text }]}
          >
            Your wallet has {formatNgnCurrency(walletBalance)}. Send at least{' '}
            {formatNgnCurrency(headStart - walletBalance)} to your wallet first,
            or untick to add it later.
          </Text>
          {fundingAccount?.account_number ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Copy account number ${fundingAccount.account_number}`}
              onPress={() => copyToClipboard(fundingAccount.account_number)}
              style={styles.accountRow}
            >
              <View style={styles.copy}>
                <Text style={[styles.account, { color: colors.text }]}>
                  {fundingAccount.account_number}
                </Text>
                <Text style={[styles.note, { color: colors.textSecondary }]}>
                  {fundingAccount.bank_name}
                </Text>
              </View>
              <Text style={styles.copyText}>{feedback ?? 'Copy'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, fontWeight: '700' },
  note: { fontSize: 13, lineHeight: 18 },
  topUp: { borderTopWidth: 1, paddingTop: 12, gap: 10 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  account: { fontSize: 20, fontWeight: '700', letterSpacing: 1 },
  copyText: { color: BRAND.primary, fontSize: 14, fontWeight: '700' },
});
