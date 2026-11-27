import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  RADIUS,
  SPACING,
  type ThemeColors,
  TYPOGRAPHY,
} from '@/constants/theme';
import { formatInboxTime, formatOrderCount } from '@/lib/merchant-inbox-format';
import { formatCurrencyNoDecimals } from '@/lib/utils';
import type { InboxCustomerProfile } from '@/schemas/merchant-inbox';

/** "IN_TRANSIT", "in-transit" and "In_Transit" all read "In transit". */
const titleCase = (value: string) =>
  value
    ? value[0].toUpperCase() +
      value.slice(1).toLowerCase().replace(/[_-]+/g, ' ')
    : '';

type Order = InboxCustomerProfile['recentOrders'][number];

/**
 * A key for each order row. The number and date normally tell rows apart; a
 * repeat of both (bad data) still gets its own key instead of merging rows.
 */
function withRowKeys(orders: Order[]): { key: string; order: Order }[] {
  const seen = new Map<string, number>();
  return orders.map((order) => {
    const base = `${order.orderNumber}-${order.createdAt ?? ''}`;
    const times = (seen.get(base) ?? 0) + 1;
    seen.set(base, times);
    return { key: times === 1 ? base : `${base}-${times}`, order };
  });
}

/** "Returning customer · 5 orders · ₦412,000", or a plain signed-in line. */
export function customerSummary(customer: InboxCustomerProfile): string {
  // Order counts and spend are order data: not shown without order access.
  if (customer.ordersHidden) return 'Signed-in customer';
  if (customer.orderCount === 0) return 'Signed-in customer · no orders yet';
  const orders = formatOrderCount(customer.orderCount);
  return `Returning customer · ${orders} · ${formatCurrencyNoDecimals(customer.totalSpent, customer.currency)}`;
}

/**
 * Who is writing: shown above a chat when the shopper was signed in on the
 * store. Tap to see their latest orders. Name and order facts only.
 */
export function CustomerCard({
  colors,
  customer,
}: {
  colors: ThemeColors;
  customer: InboxCustomerProfile;
}) {
  const [open, setOpen] = useState(false);
  const hasOrders = customer.recentOrders.length > 0;
  const last = customer.recentOrders[0];

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Pressable
        accessibilityLabel={`${customer.name}. ${customerSummary(customer)}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        disabled={!hasOrders}
        onPress={() => setOpen((value) => !value)}
        style={styles.header}
      >
        <View style={[styles.icon, { backgroundColor: colors.successLight }]}>
          <Ionicons color={colors.success} name="person-circle" size={22} />
        </View>
        <View style={styles.flex}>
          <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
            {customer.name}
          </Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>
            {customerSummary(customer)}
          </Text>
          {last && !open ? (
            <Text style={[styles.sub, { color: colors.textMuted }]}>
              Last order {last.orderNumber} · {titleCase(last.shippingStatus)}
            </Text>
          ) : null}
        </View>
        {hasOrders ? (
          <Ionicons
            color={colors.textMuted}
            name={open ? 'chevron-up' : 'chevron-down'}
            size={18}
          />
        ) : null}
      </Pressable>
      {open
        ? withRowKeys(customer.recentOrders).map(({ key, order }) => (
            <View
              key={key}
              style={[styles.order, { borderTopColor: colors.border }]}
            >
              <View style={styles.flex}>
                <Text style={[styles.orderNo, { color: colors.text }]}>
                  {order.orderNumber}
                </Text>
                <Text style={[styles.sub, { color: colors.textSecondary }]}>
                  {titleCase(order.paymentStatus)} ·{' '}
                  {titleCase(order.shippingStatus)}
                  {order.createdAt
                    ? ` · ${formatInboxTime(order.createdAt)}`
                    : ''}
                </Text>
              </View>
              <Text style={[styles.orderNo, { color: colors.text }]}>
                {formatCurrencyNoDecimals(order.total, order.currency)}
              </Text>
            </View>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
  },
  flex: { flex: 1 },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING.md,
    padding: SPACING.md,
  },
  icon: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  name: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.md,
  },
  order: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
  },
  orderNo: {
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
    fontSize: TYPOGRAPHY.size.md,
  },
  sub: { fontSize: TYPOGRAPHY.size.sm },
});
