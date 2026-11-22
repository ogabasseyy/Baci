import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  RADIUS,
  SPACING,
  type ThemeColors,
  TYPOGRAPHY,
} from '@/constants/theme';
import { formatInboxTime } from '@/lib/merchant-inbox-format';
import { formatCurrencyNoDecimals } from '@/lib/utils';
import type { InboxCustomerProfile } from '@/schemas/merchant-inbox';

const titleCase = (value: string) =>
  value ? value[0].toUpperCase() + value.slice(1).replace(/[_-]+/g, ' ') : '';

/** "Returning customer · 5 orders · ₦412,000", or a plain signed-in line. */
export function customerSummary(customer: InboxCustomerProfile): string {
  if (customer.orderCount === 0) return 'Signed-in customer · no orders yet';
  const orders =
    customer.orderCount === 1 ? '1 order' : `${customer.orderCount} orders`;
  return `Returning customer · ${orders} · ${formatCurrencyNoDecimals(customer.totalSpent)}`;
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
        ? customer.recentOrders.map((order) => (
            <View
              key={order.orderNumber}
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
                {formatCurrencyNoDecimals(order.total)}
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
