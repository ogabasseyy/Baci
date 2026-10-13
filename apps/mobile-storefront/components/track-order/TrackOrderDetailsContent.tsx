import Ionicons from '@react-native-vector-icons/ionicons';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { TrackOrderTimelineCard } from '@/components/track-order/TrackOrderTimelineCard';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import { getCustomerOrderStatusMeta } from '@/lib/customer-order-status';
import { TrackOrderContactCard } from './TrackOrderContactCard';
import { TrackOrderItemsCard } from './TrackOrderItemsCard';
import { trackOrderScreenStyles as styles } from './TrackOrderScreen.styles';
import type { TrackOrderData } from './TrackOrderScreen.types';
import {
  formatTrackOrderDate,
  formatTrackOrderPrice,
  getTrackOrderBadge,
  isValidTrackingUrl,
} from './track-order.helpers';

type ColorsScheme = (typeof Colors)['light'];

interface TrackOrderDetailsContentProps {
  colors: ColorsScheme;
  data: TrackOrderData;
}

export function TrackOrderDetailsContent({
  colors,
  data,
}: TrackOrderDetailsContentProps) {
  const {
    order,
    customer,
    shipping_address,
    items,
    timeline,
    shipping_tracking,
    estimated_delivery,
    merchant,
  } = data;
  const statusMeta = getCustomerOrderStatusMeta(order.status, merchant?.name);
  const badge = getTrackOrderBadge(order.status);

  return (
    <>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={styles.orderHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.orderNumber, { color: colors.text }]}>
              Order #{order.order_number}
            </Text>
            <Text style={[styles.orderDate, { color: colors.textSecondary }]}>
              {formatTrackOrderDate(order.created_at)}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Ionicons
              name={
                statusMeta.icon as React.ComponentProps<typeof Ionicons>['name']
              }
              size={14}
              color={badge.color}
            />
            <Text style={[styles.badgeText, { color: badge.color }]}>
              {statusMeta.shortLabel}
            </Text>
          </View>
        </View>

        {estimated_delivery && (
          <View
            style={[styles.estimatedRow, { borderTopColor: colors.border }]}
          >
            <Ionicons name="time-outline" size={16} color={BRAND.primary} />
            <Text
              style={[styles.estimatedText, { color: colors.textSecondary }]}
            >
              Estimated delivery: {estimated_delivery}
            </Text>
          </View>
        )}
      </View>

      <TrackOrderTimelineCard colors={colors} timeline={timeline} />
      {shipping_tracking && (
        <ShippingTrackingCard colors={colors} tracking={shipping_tracking} />
      )}
      <TrackOrderItemsCard
        colors={colors}
        items={items}
        currency={order.currency}
      />
      <TrackOrderSummaryCard colors={colors} order={order} />
      <TrackOrderAddressCard
        colors={colors}
        customerName={customer.name}
        shippingAddress={shipping_address}
      />
      {(merchant.support_email || merchant.support_phone) && (
        <TrackOrderContactCard colors={colors} merchant={merchant} />
      )}
      <View style={styles.bottomSpacer} />
    </>
  );
}

function ShippingTrackingCard({
  colors,
  tracking,
}: {
  colors: ColorsScheme;
  tracking: NonNullable<TrackOrderData['shipping_tracking']>;
}) {
  const openTrackingUrl = () => {
    if (isValidTrackingUrl(tracking.tracking_url)) {
      Linking.openURL(tracking.tracking_url);
      return;
    }
    Alert.alert('Tracking Unavailable', 'No valid tracking link available.');
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Shipping Tracking
      </Text>
      <View style={styles.trackingRow}>
        <Ionicons name="airplane-outline" size={20} color={BRAND.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.trackingProvider, { color: colors.text }]}>
            {tracking.provider}
          </Text>
          <Text
            style={[styles.trackingNumber, { color: colors.textSecondary }]}
          >
            {tracking.tracking_number}
          </Text>
        </View>
        {tracking.tracking_url && (
          <Pressable
            onPress={openTrackingUrl}
            style={({ pressed }) => [
              styles.trackBtn,
              { backgroundColor: BRAND.primaryLight },
              pressed && { opacity: 0.8 },
            ]}
            accessibilityRole="link"
            accessibilityLabel="Track your order"
            accessibilityHint="Opens tracking link in browser"
          >
            <Text style={[styles.trackBtnText, { color: BRAND.primary }]}>
              Track
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function TrackOrderSummaryCard({
  colors,
  order,
}: {
  colors: ColorsScheme;
  order: TrackOrderData['order'];
}) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Order Summary
      </Text>
      <SummaryRow
        label="Subtotal"
        value={formatTrackOrderPrice(order.subtotal, order.currency)}
        colors={colors}
      />
      <SummaryRow
        label="Shipping"
        value={
          order.shipping_cost > 0
            ? formatTrackOrderPrice(order.shipping_cost, order.currency)
            : 'Free'
        }
        colors={colors}
      />
      {order.discount_amount > 0 && (
        <SummaryRow
          label="Discount"
          value={`-${formatTrackOrderPrice(order.discount_amount, order.currency)}`}
          colors={colors}
          valueColor="#10B981"
        />
      )}
      <View
        style={[styles.summaryDivider, { backgroundColor: colors.border }]}
      />
      <View style={styles.summaryRow}>
        <Text style={[styles.totalLabel, { color: colors.text }]}>Total</Text>
        <Text style={[styles.totalValue, { color: colors.text }]}>
          {formatTrackOrderPrice(order.total, order.currency)}
        </Text>
      </View>
    </View>
  );
}

function SummaryRow({
  colors,
  label,
  value,
  valueColor,
}: {
  colors: ColorsScheme;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Text style={[styles.summaryValue, { color: valueColor || colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

function TrackOrderAddressCard({
  colors,
  customerName,
  shippingAddress,
}: {
  colors: ColorsScheme;
  customerName: string;
  shippingAddress: TrackOrderData['shipping_address'];
}) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Shipping Address
      </Text>
      <View style={styles.addressRow}>
        <Ionicons name="location-outline" size={20} color={BRAND.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.addressName, { color: colors.text }]}>
            {customerName}
          </Text>
          <Text style={[styles.addressText, { color: colors.textSecondary }]}>
            {shippingAddress.address}
          </Text>
          {(shippingAddress.city || shippingAddress.state) && (
            <Text style={[styles.addressText, { color: colors.textSecondary }]}>
              {[shippingAddress.city, shippingAddress.state]
                .filter(Boolean)
                .join(', ')}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}
