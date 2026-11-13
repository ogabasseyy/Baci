import Ionicons from '@react-native-vector-icons/ionicons';
import { Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { hexToRgba } from '@/lib/hex-to-rgba';
import type { PiggyvestWalletActivityItem } from '@/schemas/piggyvest-wallet-activity';
import { styles } from '../wallet.styles';

function formatActivityDate(value: string) {
  return new Date(value).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** One PiggyVest wallet movement: money in green, money out neutral. */
export function PiggyvestActivityRow({
  colors,
  item,
}: {
  colors: (typeof Colors)['light'];
  item: PiggyvestWalletActivityItem;
}) {
  const incoming = item.direction === 'in';
  const tint = incoming ? colors.success : colors.text;
  const amount = `${incoming ? '+' : '−'}${formatNgnCurrency(item.amountKobo / 100)}`;
  const date = formatActivityDate(item.occurredAt);
  const pending = item.status === 'pending';
  // PiggyVest takes its deposit fee from the transfer: the amount shown is
  // what reached the wallet, and the fee is named so the two reconcile.
  const fee =
    item.feeKobo > 0
      ? `${formatNgnCurrency(item.feeKobo / 100)} fee deducted`
      : null;
  const detail = [pending ? 'Pending' : null, fee, date]
    .filter(Boolean)
    .join(' · ');
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${item.label}. ${amount}. ${detail}.`}
      style={[styles.transactionItem, { borderBottomColor: colors.border }]}
    >
      <View style={[styles.txIcon, { backgroundColor: hexToRgba(tint, 0.12) }]}>
        <Ionicons
          accessible={false}
          importantForAccessibility="no"
          name={incoming ? 'arrow-down' : 'arrow-up'}
          size={18}
          color={tint}
        />
      </View>
      <View style={styles.txDetails}>
        <Text style={[styles.txDescription, { color: colors.text }]}>
          {item.label}
        </Text>
        <Text style={[styles.txDate, { color: colors.textSecondary }]}>
          {detail}
        </Text>
      </View>
      <Text style={[styles.txAmount, { color: tint }]}>{amount}</Text>
    </View>
  );
}
