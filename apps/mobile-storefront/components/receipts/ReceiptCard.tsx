import { MANUAL_ORDER_CURRENCY_CODE_PATTERN } from '@baci/shared/receipt';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import type React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BRAND, SHADOWS } from '@/constants/Colors';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import type { ReceiptListItem } from '@/types/receipt';
import { formatReceiptDate } from './receipt-date';
import { resolveReceiptCardKind } from './resolve-receipt-card-kind';

const PAYMENT_STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  paid: { label: 'Receipt', color: '#059669', icon: 'checkmark-circle' },
  partially_paid: {
    label: 'Partial',
    color: '#D97706',
    icon: 'ellipsis-horizontal-circle',
  },
  unpaid: { label: 'Invoice', color: '#DC2626', icon: 'document-text' },
  refunded: { label: 'Refunded', color: '#6B7280', icon: 'refresh-circle' },
};

export function getPaymentConfig(status: string) {
  return PAYMENT_STATUS_CONFIG[status] ?? PAYMENT_STATUS_CONFIG.unpaid;
}

const PRICE_FORMATTER_CACHE = new Map<string, Intl.NumberFormat>();

function getPriceFormatter(currency: string): Intl.NumberFormat {
  let formatter = PRICE_FORMATTER_CACHE.get(currency);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
      });
    } catch (error) {
      // Malformed codes (legacy rows the sender would skip) degrade to
      // NGN, cached under the bad key so they rethrow once. NGN rethrows
      // so a broken default fails fast; well-formed-but-unassigned codes
      // rethrow for formatPrice to render code-prefixed like the PDF.
      if (currency === 'NGN') throw error;
      if (MANUAL_ORDER_CURRENCY_CODE_PATTERN.test(currency)) throw error;
      const fallback = getPriceFormatter('NGN');
      PRICE_FORMATTER_CACHE.set(currency, fallback);
      return fallback;
    }
    PRICE_FORMATTER_CACHE.set(currency, formatter);
  }
  return formatter;
}

export function formatPrice(
  price: number,
  currency: string | null | undefined = 'NGN'
) {
  // Non-finite values render a neutral placeholder, never a confident
  // zero: a corrupt total must not mask as valid money on the card.
  if (!Number.isFinite(price)) return '-';
  const code = currency ?? 'NGN';
  try {
    return getPriceFormatter(code).format(price);
  } catch (error) {
    if (code === 'NGN') throw error;
    // Well-formed but unassigned on Hermes: prefix the code like Node's
    // ICU and the PDF instead of mislabeling as NGN.
    return `${code} ${price.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
  }
}

interface ReceiptCardProps {
  item: ReceiptListItem;
  colors: { card: string; text: string; textSecondary: string };
  onPress: (item: ReceiptListItem) => void;
  onPrefetch?: (orderId: string) => void;
}

export function ReceiptCard({
  item,
  colors,
  onPress,
  onPrefetch,
}: ReceiptCardProps) {
  // A cached entry can outlive a terminal shipping flip: fail a stale
  // receipt kind closed to invoice through the promotion gate.
  const effectiveKind = resolveReceiptCardKind(item);
  // Badge/action follow the effective kind both ways: covered manual
  // opens receipt; explicit invoice never badges paid. Absent kind
  // (legacy rows) falls back to the raw status; legacy casings (Paid,
  // PAID) normalize like the list paid-shortcut, typeof guard included.
  const paidLabel =
    typeof item.payment_status === 'string' &&
    item.payment_status.trim().toLowerCase() === 'paid';
  let displayStatus = item.payment_status;
  if (effectiveKind === 'receipt') {
    displayStatus = 'paid';
  } else if (effectiveKind === 'invoice' && paidLabel) {
    displayStatus = 'unpaid';
  }
  // Money follows the ledger: a paid label on an invoice still reads Paid.
  const moneyPaid = displayStatus === 'paid' || paidLabel;
  // Invalid manual rows badge Invoice under paid: explain no receipt exists.
  const invalidPaidInvoice = effectiveKind === 'invoice' && paidLabel;
  const config = getPaymentConfig(displayStatus);
  const firstItem = item.items[0];
  const productTitle = firstItem
    ? `${firstItem.product_name}${
        item.items.length > 1 ? ` +${item.items.length - 1} more` : ''
      }`
    : `Order #${item.order_number}`;
  // VoiceOver hears badge + money + explainer/balance, not kind alone.
  const balance = item.total - item.amount_paid;
  // Hide corrupt balances: formatPrice degrades non-finite input to NGN 0.
  const showBalance =
    displayStatus === 'partially_paid' && Number.isFinite(balance);
  const accessibilityMoney = `${moneyPaid ? 'Paid' : 'Total'} ${formatPrice(item.total, item.currency)}`;
  const accessibilityLabel =
    `${config.label} for ${productTitle}, order ${item.order_number}, ${accessibilityMoney}` +
    (showBalance ? `, balance ${formatPrice(balance, item.currency)}` : '') +
    (invalidPaidInvoice ? ', payment recorded, invoice only, no receipt' : '');

  return (
    <TouchableOpacity
      style={[styles.card, SHADOWS.sm, { backgroundColor: colors.card }]}
      onPress={() => onPress(item)}
      onPressIn={() => onPrefetch?.(item.id)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.thumb, { backgroundColor: `${BRAND.primary}12` }]}>
          {firstItem?.image_url ? (
            <Image
              source={createSafeBoundedImageSource({
                height: 52,
                uri: firstItem.image_url,
                width: 52,
              })}
              style={styles.thumbImage}
              contentFit="contain"
              cachePolicy="memory-disk"
              transition={150}
              autoplay={false}
              accessibilityLabel={firstItem.product_name}
            />
          ) : (
            <Ionicons
              name="phone-portrait-outline"
              size={22}
              color={BRAND.primary}
            />
          )}
        </View>
        <View style={styles.headerCopy}>
          {/* Product name is the primary line; order # is secondary metadata. */}
          <Text
            style={[styles.productName, { color: colors.text }]}
            numberOfLines={1}
          >
            {productTitle}
          </Text>
          <Text
            style={[styles.metaLine, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            #{item.order_number} ·{' '}
            {formatReceiptDate(
              item.invoice_issue_date ??
                item.transaction_date ??
                item.created_at
            )}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: `${config.color}15` }]}>
          <Ionicons
            name={config.icon as React.ComponentProps<typeof Ionicons>['name']}
            size={13}
            color={config.color}
          />
          <Text style={[styles.badgeText, { color: config.color }]}>
            {config.label}
          </Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View>
          <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>
            {moneyPaid ? 'Paid' : 'Total'}
          </Text>
          <Text style={[styles.totalAmount, { color: colors.text }]}>
            {formatPrice(item.total, item.currency)}
          </Text>
          {showBalance && (
            <Text style={[styles.balanceLabel, { color: '#D97706' }]}>
              Balance: {formatPrice(balance, item.currency)}
            </Text>
          )}
          {invalidPaidInvoice && (
            <Text
              style={[styles.balanceLabel, { color: colors.textSecondary }]}
            >
              Payment recorded — invoice only, no receipt
            </Text>
          )}
        </View>
        <View style={styles.viewAction}>
          <Text style={[styles.viewActionText, { color: BRAND.primary }]}>
            View {config.label}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={BRAND.primary} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: {
    width: '100%',
    height: '100%',
    padding: 4,
  },
  headerCopy: {
    flex: 1,
  },
  productName: {
    fontSize: 16,
    fontWeight: '700',
  },
  metaLine: {
    fontSize: 12,
    marginTop: 3,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    gap: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E5E5',
  },
  totalLabel: {
    fontSize: 12,
  },
  totalAmount: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 2,
  },
  balanceLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
  },
  viewAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewActionText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
