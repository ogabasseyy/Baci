import { buildMailtoLink, normalizeStoredE164Phone } from '@baci/shared';
import Ionicons from '@react-native-vector-icons/ionicons';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import type { FailedOrder } from '@/hooks/useFailedOrders';
import { useTheme } from '@/hooks/useTheme';
import { getFollowUpStatusLabel } from '@/lib/follow-up-status';

interface FollowUpOrderCardProps {
  item: FailedOrder;
  displayTotal: string;
  initials: string;
}

export function FollowUpOrderCard({
  item,
  displayTotal,
  initials,
}: FollowUpOrderCardProps) {
  const router = useRouter();
  const { colors, shadows } = useTheme();
  const errorMessage = getFollowUpStatusLabel(item);

  const displayName = item.customer_name || 'Guest';
  const emailLink = buildMailtoLink(item.customer_email);
  const customerPhone = item.customer_phone?.trim() || null;
  const phoneDigits = customerPhone?.replace(/\D/g, '') || '';
  // Raw order phones have no guaranteed country code; preserve national calls.
  const hasInternationalPrefix =
    customerPhone?.startsWith('+') || customerPhone?.startsWith('00');
  const whatsAppPhone = hasInternationalPrefix
    ? normalizeStoredE164Phone(
        phoneDigits.startsWith('00') ? phoneDigits.slice(2) : phoneDigits
      )
    : null;
  const callPhone = hasInternationalPrefix
    ? whatsAppPhone && `+${whatsAppPhone}`
    : /^(?!0+$)\d{8,15}$/.test(phoneDigits)
      ? phoneDigits
      : null;
  const customerId = item.oxygen_follow_up_status ? null : item.customer_id;
  const handlePress = () => {
    if (customerId) {
      router.push({
        pathname: '/(admin)/customer/[id]',
        params: { id: customerId },
      });
      return;
    }
    router.push({ pathname: '/(admin)/order/[id]', params: { id: item.id } });
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.customerCard,
        { backgroundColor: colors.card, minHeight: 56 },
        shadows.sm,
        pressed && { backgroundColor: colors.cardHover },
      ]}
      onPress={handlePress}
      accessibilityLabel={`Follow up: ${displayName}, ${item.customer_email}, ${displayTotal}, ${errorMessage}`}
      accessibilityRole="button"
      accessibilityHint="View customer or order details"
    >
      <View style={[styles.avatar, { backgroundColor: colors.goldLight }]}>
        <Text style={[styles.avatarText, { color: colors.gold }]}>
          {initials}
        </Text>
      </View>

      <View style={styles.customerInfo}>
        <Text
          style={[styles.customerName, { color: colors.text }]}
          numberOfLines={1}
        >
          {displayName}
        </Text>
        {item.customer_email ? (
          <Text
            style={[styles.customerEmail, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {item.customer_email}
          </Text>
        ) : null}

        <Text
          style={[
            styles.errorText,
            {
              color: item.staff_follow_up_only
                ? colors.textSecondary
                : (item.oxygen_follow_up_status &&
                      item.oxygen_follow_up_status !== 'needs_review') ||
                    item.payment_status === 'pending' ||
                    item.payment_status === 'unpaid' ||
                    item.payment_status === 'expired'
                  ? colors.warning
                  : colors.error,
            },
          ]}
          numberOfLines={2}
        >
          {displayTotal} • {errorMessage}
        </Text>
      </View>

      <View style={styles.actionRow}>
        {whatsAppPhone ? (
          <Pressable
            style={[
              styles.miniActionButton,
              {
                backgroundColor: colors.successLight,
                minWidth: 44,
                minHeight: 44,
              },
            ]}
            onPress={(e) => {
              e.stopPropagation();
              void Linking.openURL(`https://wa.me/${whatsAppPhone}`);
            }}
            accessibilityLabel={`Message ${displayName} on WhatsApp`}
            accessibilityRole="button"
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="logo-whatsapp" size={16} color={colors.success} />
          </Pressable>
        ) : null}
        {callPhone ? (
          <Pressable
            style={[
              styles.miniActionButton,
              {
                backgroundColor: colors.backgroundLight,
                minWidth: 44,
                minHeight: 44,
              },
            ]}
            onPress={(e) => {
              e.stopPropagation();
              void Linking.openURL(`tel:${callPhone}`);
            }}
            accessibilityLabel={`Call ${displayName}`}
            accessibilityRole="button"
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="call" size={16} color={colors.textSecondary} />
          </Pressable>
        ) : null}
        {emailLink ? (
          <Pressable
            style={[
              styles.miniActionButton,
              {
                backgroundColor: colors.primaryLight,
                minWidth: 44,
                minHeight: 44,
              },
            ]}
            onPress={(e) => {
              e.stopPropagation();
              void Linking.openURL(emailLink);
            }}
            accessibilityLabel={`Email ${displayName}`}
            accessibilityRole="button"
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="mail" size={16} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  customerCard: {
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  avatarText: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  customerInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  customerName: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.semiBold,
  },
  customerEmail: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    marginBottom: 4,
  },
  errorText: {
    fontSize: TYPOGRAPHY.size.xs,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  miniActionButton: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
