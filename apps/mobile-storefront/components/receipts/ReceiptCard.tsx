import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import type React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BRAND, SHADOWS } from '@/constants/Colors';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import type { ReceiptListItem } from '@/types/receipt';
import { formatReceiptDate } from './receipt-date';

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
    } catch {
      // Malformed or unknown currency codes (legacy rows the sender
      // would skip) degrade to NGN instead of crashing the list render
      // with RangeError. A regex alone cannot cover well-formed but
      // unassigned codes, so construction itself is guarded. Malformed
      // keys are deliberately not cached: every unique legacy code would
      // otherwise add a Map entry pointing at the same NGN formatter.
      return getPriceFormatter('NGN');
    }
    PRICE_FORMATTER_CACHE.set(currency, formatter);
  }
  return formatter;
}

export function formatPrice(
  price: number,
  currency: string | null | undefined = 'NGN'
) {
  return getPriceFormatter(currency ?? 'NGN').format(price);
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
  // Badge/action follow the effective document kind both ways: a covered
  // manual balance under a non-paid label opens a receipt, so the card says
  // receipt — and an explicit invoice kind never badges paid even under a
  // paid label (invalid manual rows open invoices). Absent kind (legacy
  // rows) falls back to the raw status.
  let displayStatus = item.payment_status;
  if (item.document_kind === 'receipt') {
    displayStatus = 'paid';
  } else if (
    item.document_kind === 'invoice' &&
    item.payment_status === 'paid'
  ) {
    displayStatus = 'unpaid';
  }
  const config = getPaymentConfig(displayStatus);
  const firstItem = item.items[0];
  const productTitle = firstItem
    ? `${firstItem.product_name}${
        item.items.length > 1 ? ` +${item.items.length - 1} more` : ''
      }`
    : `Order #${item.order_number}`;

  return (
    <TouchableOpacity
      style={[styles.card, SHADOWS.sm, { backgroundColor: colors.card }]}
      onPress={() => onPress(item)}
      onPressIn={() => onPrefetch?.(item.id)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${config.label} for ${productTitle}, order ${item.order_number}`}
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
            {displayStatus === 'paid' ? 'Paid' : 'Total'}
          </Text>
          <Text style={[styles.totalAmount, { color: colors.text }]}>
            {formatPrice(item.total, item.currency)}
          </Text>
          {displayStatus === 'partially_paid' && (
            <Text style={[styles.balanceLabel, { color: '#D97706' }]}>
              Balance:{' '}
              {formatPrice(item.total - item.amount_paid, item.currency)}
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
