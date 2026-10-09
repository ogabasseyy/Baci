import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { styles } from '@/components/transactions/transactions.styles';
import type { ThemeColors } from '@/constants/theme';
import type {
  TransactionReviewItem,
  TransactionReviewOrder,
} from '@/hooks/useTransactionReview';
import { formatProductCondition } from '@/lib/product-condition';
import { formatTransactionDisplayText } from './transaction-display-format';

interface TransactionOrderCardItemProps {
  colors: ThemeColors;
  formatCurrency: (amount: number) => string;
  item: TransactionReviewItem;
  onOpenEditor: (
    order: TransactionReviewOrder,
    item: TransactionReviewItem
  ) => void;
  order: TransactionReviewOrder;
}

export function TransactionOrderCardItem({
  colors,
  formatCurrency,
  item,
  onOpenEditor,
  order,
}: TransactionOrderCardItemProps) {
  const isLoss = item.profit != null && item.profit < 0;
  const itemName = formatTransactionDisplayText(item.name);
  const supplierName = formatTransactionDisplayText(item.supplierName);
  const profitLabel =
    item.profit == null
      ? 'Profit unavailable'
      : isLoss
        ? `Loss ${formatCurrency(Math.abs(item.profit))}`
        : `Profit ${formatCurrency(item.profit)}`;
  return (
    <Pressable
      style={[styles.itemRow, { borderTopColor: colors.border }]}
      onPress={() => onOpenEditor(order, item)}
      accessibilityRole="button"
      accessibilityLabel={`${itemName}, ${item.quantity} units, revenue ${formatCurrency(item.revenue)}${
        supplierName ? `, supplier ${supplierName}` : ''
      }`}
      accessibilityHint="Opens the transaction editor for this item"
    >
      <View style={styles.flexOne}>
        <Text style={[styles.itemName, { color: colors.text }]}>
          {itemName}
        </Text>
        <Text style={[styles.orderSubtitle, { color: colors.textSecondary }]}>
          {item.quantity} units · Revenue {formatCurrency(item.revenue)}
        </Text>
        {supplierName ? (
          <Text style={[styles.itemDetailText, { color: colors.textMuted }]}>
            Supplier {supplierName}
          </Text>
        ) : null}
        {!item.productId ? (
          <Text style={[styles.itemDetailText, { color: colors.textMuted }]}>
            Custom item
          </Text>
        ) : null}
        {item.imeiValues[0] ? (
          <Text style={[styles.itemDetailText, { color: colors.textMuted }]}>
            IMEI {item.imeiValues[0]}
          </Text>
        ) : null}
        {item.serialValues[0] ? (
          <Text style={[styles.itemDetailText, { color: colors.textMuted }]}>
            S/N {item.serialValues[0]}
          </Text>
        ) : null}
        {item.condition || item.offerId ? (
          <Text style={[styles.itemDetailText, { color: colors.textMuted }]}>
            {item.condition
              ? `Condition ${formatProductCondition(item.condition) ?? item.condition}`
              : null}
            {item.condition && item.offerId ? ' · ' : null}
            {item.offerId ? `Offer ${String(item.offerId).slice(0, 8)}` : null}
          </Text>
        ) : null}
      </View>
      <View style={styles.itemMeta}>
        <Text style={[styles.itemMetaValue, { color: colors.text }]}>
          {item.costPrice == null
            ? 'Cost missing'
            : `Cost ${formatCurrency(item.costPrice)}`}
        </Text>
        <Text
          style={[
            styles.orderSubtitle,
            {
              color:
                item.costPrice == null || isLoss
                  ? colors.error
                  : colors.textMuted,
            },
          ]}
        >
          {profitLabel}
        </Text>
      </View>
      <Ionicons name="create-outline" size={18} color={colors.textMuted} />
    </Pressable>
  );
}
