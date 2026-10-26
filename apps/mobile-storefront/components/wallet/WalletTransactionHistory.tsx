import Ionicons from '@react-native-vector-icons/ionicons';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type Colors from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { hexToRgba } from '@/lib/hex-to-rgba';
import { styles } from './wallet.styles';

type WalletColors = (typeof Colors)['light'];

export interface WalletTransaction {
  goal_id?: string;
  amount: number;
  created_at: string;
  description: string;
  id: string;
  /**
   * Ledger provenance (`customer_wallet_transactions.source_type`). Not
   * rendered — the credit watch uses it to tell a `wallet_topup` funding credit
   * apart from cashback/reversal credits.
   */
  source_type?: string | null;
  type:
    | 'credit'
    | 'debit'
    | 'cashback'
    | 'redemption'
    | 'bonus'
    | 'adjustment'
    | 'expiry'
    | 'refund';
}

interface WalletTransactionHistoryProps {
  colors: WalletColors;
  transactions: WalletTransaction[];
}

const TRANSACTION_TYPE_LABELS: Record<WalletTransaction['type'], string> = {
  credit: 'Credit',
  debit: 'Debit',
  cashback: 'Cashback',
  redemption: 'Redemption',
  bonus: 'Bonus',
  adjustment: 'Adjustment',
  expiry: 'Expiry',
  refund: 'Refund',
};

function humanizeTransactionType(type: WalletTransaction['type']): string {
  return TRANSACTION_TYPE_LABELS[type];
}

function formatWalletDate(dateString: string) {
  return new Date(dateString).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WalletTransactionHistory({
  colors,
  transactions,
}: WalletTransactionHistoryProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(400).delay(200)}
      style={[styles.historySection, { backgroundColor: colors.card }]}
    >
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Recent Transactions
      </Text>

      {transactions.length === 0 ? (
        <View style={styles.emptyTransactions}>
          <Ionicons
            accessible={false}
            importantForAccessibility="no"
            name="receipt-outline"
            size={40}
            color={colors.textSecondary}
          />
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No transactions yet
          </Text>
        </View>
      ) : (
        transactions.map((transaction) => {
          const isCredit =
            ['credit', 'cashback', 'bonus', 'refund'].includes(
              transaction.type
            ) ||
            (transaction.type === 'adjustment' && transaction.amount > 0);
          const isDebit =
            ['debit', 'redemption', 'expiry'].includes(transaction.type) ||
            (transaction.type === 'adjustment' && transaction.amount < 0);
          // Adjustment rows are signed by amount because the backend type is neutral.
          const amountPrefix = isCredit ? '+' : isDebit ? '-' : '';
          const amountColor = isCredit
            ? colors.success
            : isDebit
              ? colors.error
              : colors.textSecondary;
          // Visual icon decisions are based on credit/debit/neutral semantics;
          // screen readers get the specific type (Cashback, Redemption, etc.).
          const transactionIcon = isCredit
            ? 'arrow-down'
            : isDebit
              ? 'arrow-up'
              : 'remove';
          const accessibleType = humanizeTransactionType(transaction.type);

          return (
            <View
              accessible
              accessibilityRole="text"
              accessibilityLabel={`${accessibleType}. ${transaction.description}. ${amountPrefix}${formatNgnCurrency(Math.abs(transaction.amount))}. ${formatWalletDate(transaction.created_at)}.`}
              key={transaction.id}
              style={[
                styles.transactionItem,
                { borderBottomColor: colors.border },
              ]}
            >
              <View
                style={[
                  styles.txIcon,
                  {
                    backgroundColor: hexToRgba(amountColor, 0.12),
                  },
                ]}
              >
                <Ionicons
                  accessible={false}
                  importantForAccessibility="no"
                  name={transactionIcon}
                  size={18}
                  color={amountColor}
                />
              </View>
              <View style={styles.txDetails}>
                <Text
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  style={[styles.txDescription, { color: colors.text }]}
                >
                  {transaction.description}
                </Text>
                <Text style={[styles.txDate, { color: colors.textSecondary }]}>
                  {formatWalletDate(transaction.created_at)}
                </Text>
              </View>
              <Text style={[styles.txAmount, { color: amountColor }]}>
                {amountPrefix}
                {formatNgnCurrency(Math.abs(transaction.amount))}
              </Text>
            </View>
          );
        })
      )}
    </Animated.View>
  );
}
