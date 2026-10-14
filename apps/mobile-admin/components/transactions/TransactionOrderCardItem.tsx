import Ionicons from '@react-native-vector-icons/ionicons';
import { Alert, Pressable, Text, View } from 'react-native';
import { styles } from '@/components/transactions/transactions.styles';
import { SPACING, type ThemeColors } from '@/constants/theme';
import type {
  TransactionReviewItem,
  TransactionReviewOrder,
} from '@/hooks/useTransactionReview';
import { formatProductCondition } from '@/lib/product-condition';
import { formatTransactionDisplayText } from './transaction-display-format';

// Dynamic import: expo-clipboard pulls native modules that test runners
// without the Expo runtime cannot load; copy is press-time only.
async function copyOfferRef(offerId: string) {
  const clipboard = await import('expo-clipboard');
  await clipboard.setStringAsync(offerId);
}

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
  // The row is a View with separate press targets: nesting the copy
  // control inside the editor pressable would stack two buttons (a
  // focus/voice-control hazard on web) and double-trigger without
  // stopPropagation, which native responder events do not guarantee.
  return (
    <View style={[styles.itemRow, { borderTopColor: colors.border }]}>
      <Pressable
        // Inline: transactions.styles.ts sits at the 300-line module
        // ceiling, so this row layout lives with its only consumer.
        style={{
          alignItems: 'center',
          flex: 1,
          flexDirection: 'row',
          gap: SPACING.xs,
        }}
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
          {item.condition || item.offerGrade || item.offerConditionNotes ? (
            <Text style={[styles.itemDetailText, { color: colors.textMuted }]}>
              {[
                item.condition
                  ? `Condition ${formatProductCondition(item.condition) ?? item.condition}`
                  : null,
                item.offerGrade ? `Grade ${item.offerGrade}` : null,
                item.offerConditionNotes ?? null,
              ]
                .filter(Boolean)
                .join(' · ')}
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
      {item.offerId ? (
        // Truncated for scannability: a prefix can collide across
        // offers, so the full id stays one tap away via copy (and in
        // the accessibility label for screen readers). A sibling of
        // the editor pressable, so no stopPropagation is needed.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Copy full offer reference ${String(item.offerId)}`}
          onPress={() => {
            // Clipboard writes can reject (permissions, web denial):
            // surface a failure instead of failing silent on a ref
            // the truncated label never confirms.
            copyOfferRef(String(item.offerId)).catch(() => {
              Alert.alert(
                'Copy failed',
                'Could not copy the offer reference. Please try again.'
              );
            });
          }}
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            gap: 4,
          }}
        >
          <Text style={[styles.itemDetailText, { color: colors.textMuted }]}>
            Offer {String(item.offerId).slice(0, 8)}
          </Text>
          <Ionicons color={colors.textMuted} name="copy-outline" size={12} />
        </Pressable>
      ) : null}
    </View>
  );
}
