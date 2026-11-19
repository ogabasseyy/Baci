import type { PaymentStatus, ShippingStatus } from '@baci/shared';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useRef } from 'react';
import type { ViewInstance } from 'react-native';
import {
  type GestureResponderEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import type { Order } from '@/hooks/useOrders';
import { useTheme } from '@/hooks/useTheme';
import { formatPrice } from './format-price';
import { formatTime } from './format-time';
import type {
  PaymentStatusConfigGetter,
  ShippingStatusConfigGetter,
  SourceConfigGetter,
  StatusPressLayout,
} from './types';

interface OrderItemProps {
  item: Order;
  currency: string;
  onPress: (id: string) => void;
  onStatusPress: (order: Order, layout: StatusPressLayout) => void;
  getShippingStatusConfig: ShippingStatusConfigGetter;
  getPaymentStatusConfig: PaymentStatusConfigGetter;
  getSourceConfig: SourceConfigGetter;
}

function getFallbackStatusLayout(
  event: GestureResponderEvent
): StatusPressLayout {
  return {
    height: 32,
    pageX: event.nativeEvent.pageX,
    pageY: event.nativeEvent.pageY,
  };
}

export function OrderItem({
  item,
  currency,
  onPress,
  onStatusPress,
  getShippingStatusConfig,
  getPaymentStatusConfig,
  getSourceConfig,
}: OrderItemProps) {
  const { colors, shadows } = useTheme();
  const shippingConfig = getShippingStatusConfig(
    item.shipping_status as ShippingStatus
  );
  const paymentConfig = getPaymentStatusConfig(
    item.payment_status as PaymentStatus
  );
  const sourceConfig = getSourceConfig(item.source);
  const itemCount = item.item_count ?? 0;
  const statusBadgeRef = useRef<ViewInstance>(null);

  const handleStatusPress = (event: GestureResponderEvent) => {
    event.stopPropagation();
    const fallbackLayout = getFallbackStatusLayout(event);

    const statusBadge = statusBadgeRef.current;
    if (!statusBadge?.measure) {
      onStatusPress(item, fallbackLayout);
      return;
    }

    statusBadge.measure(
      (_x, _y, _width, measuredHeight, measuredPageX, measuredPageY) => {
        onStatusPress(item, {
          height: Number.isFinite(measuredHeight)
            ? measuredHeight
            : fallbackLayout.height,
          pageX: Number.isFinite(measuredPageX)
            ? measuredPageX
            : fallbackLayout.pageX,
          pageY: Number.isFinite(measuredPageY)
            ? measuredPageY
            : fallbackLayout.pageY,
        });
      }
    );
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.orderCard,
        { backgroundColor: colors.card, minHeight: 56 },
        shadows.sm,
        pressed && { backgroundColor: colors.cardHover },
      ]}
      onPress={() => onPress(item.id)}
      accessibilityLabel={`Order ${item.order_number} from ${item.customer_name}, ${formatPrice(item.total, currency)}, ${shippingConfig.label}, ${paymentConfig.label}`}
      accessibilityRole="button"
      accessibilityHint="View order details"
    >
      <View style={styles.orderHeader}>
        <View style={styles.orderNumberRow}>
          <View
            style={[
              styles.sourceIcon,
              { backgroundColor: `${sourceConfig.color}15` },
            ]}
          >
            <Ionicons
              name={sourceConfig.icon}
              size={16}
              color={sourceConfig.color}
            />
          </View>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={[styles.customerName, { color: colors.text }]}
          >
            {item.customer_name}
          </Text>
        </View>
        <View style={styles.statusBadges}>
          <View
            style={[
              styles.paymentBadge,
              { backgroundColor: `${paymentConfig.color}20` },
            ]}
          >
            <Text style={[styles.paymentText, { color: paymentConfig.color }]}>
              {paymentConfig.label}
            </Text>
          </View>
          <Pressable
            ref={statusBadgeRef}
            collapsable={false}
            style={[
              styles.statusBadge,
              { backgroundColor: `${shippingConfig.color}20`, minHeight: 32 },
            ]}
            onPress={handleStatusPress}
            hitSlop={8}
            accessibilityLabel={`Shipping status: ${shippingConfig.label}. Tap to change status`}
            accessibilityRole="button"
            accessibilityHint="Opens status change menu"
          >
            <View
              style={[
                styles.statusDot,
                { backgroundColor: shippingConfig.color },
              ]}
            />
            <Text style={[styles.statusText, { color: shippingConfig.color }]}>
              {shippingConfig.label}
            </Text>
            <Ionicons
              name="chevron-down"
              size={12}
              color={shippingConfig.color}
            />
          </Pressable>
        </View>
      </View>

      <Text style={[styles.orderNumber, { color: colors.textSecondary }]}>
        {item.order_number}
      </Text>
      <View style={styles.orderFooter}>
        <Text style={[styles.orderTotal, { color: colors.text }]}>
          {formatPrice(item.total, currency)}
        </Text>
        <View style={styles.orderMetaRow}>
          <Text style={[styles.orderMetaBold, { color: colors.textSecondary }]}>
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </Text>
          <Text style={[styles.orderMetaDot, { color: colors.textMuted }]}>
            •
          </Text>
          <Text style={[styles.orderMeta, { color: colors.textMuted }]}>
            {formatTime(item.created_at)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  orderCard: { borderRadius: RADIUS.lg, padding: SPACING.lg },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  orderNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flex: 1,
    marginRight: SPACING.sm,
  },
  sourceIcon: {
    width: 28,
    height: 28,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderNumber: {
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    marginBottom: SPACING.md,
  },
  statusBadges: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  paymentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
  },
  paymentText: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    gap: 6,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
  },
  customerName: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    flex: 1,
  },
  orderFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderTotal: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  orderMeta: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
  },
  orderMetaBold: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
  },
  orderMetaRow: { flexDirection: 'row', alignItems: 'center' },
  orderMetaDot: { marginHorizontal: 6, fontSize: TYPOGRAPHY.size.xs },
});
