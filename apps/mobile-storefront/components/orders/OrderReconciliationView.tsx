import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { orderSuccessStyles as styles } from '@/components/orders/order-success.styles';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';

interface OrderReconciliationViewProps {
  colors: typeof Colors.light;
  isDark: boolean;
  orderNumber?: string;
  onContinueShopping: () => void;
  onViewOrders: () => void;
}

/**
 * Captured-but-cancelled/refunded state: the provider took the money but
 * the finalizer left no active paid order (a reconciliation review was
 * filed). Rendered instead of the confirmation — never alongside it —
 * with the cart intact for a fresh attempt.
 */
export function OrderReconciliationView({
  colors,
  isDark,
  orderNumber,
  onContinueShopping,
  onViewOrders,
}: OrderReconciliationViewProps) {
  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['top', 'left', 'right']}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={styles.content}>
            <View style={styles.iconContainer}>
              <Ionicons
                name="hourglass-outline"
                size={84}
                color={BRAND.secondary}
              />
            </View>
            <View
              style={[
                styles.eyebrowPill,
                {
                  backgroundColor: isDark
                    ? 'rgba(245, 158, 11, 0.16)'
                    : 'rgba(245, 158, 11, 0.12)',
                },
              ]}
            >
              <Text style={styles.eyebrowText}>Payment under review</Text>
            </View>
            <Text style={[styles.title, { color: colors.text }]}>
              Payment Received — Order Under Review
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Your payment went through, but this order was cancelled before it
              could be confirmed. Our team is reconciling it now — any amount
              due back to you will be refunded automatically.
            </Text>
            <View
              style={[
                styles.orderInfo,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.orderRow}>
                <Ionicons
                  name="receipt-outline"
                  size={18}
                  color={BRAND.primary}
                />
                <Text
                  style={[styles.orderLabel, { color: colors.textSecondary }]}
                >
                  Order Number
                </Text>
                <Text style={[styles.orderValue, { color: colors.text }]}>
                  #{orderNumber || 'Processing...'}
                </Text>
              </View>
            </View>
            <View style={styles.actions}>
              <View style={styles.actionRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Continue Shopping"
                  style={[
                    styles.secondaryButton,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                  onPress={onContinueShopping}
                >
                  <Text
                    style={[styles.secondaryButtonText, { color: colors.text }]}
                  >
                    Continue Shopping
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="View Orders"
                  style={[
                    styles.secondaryButton,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                  onPress={onViewOrders}
                >
                  <Text
                    style={[styles.secondaryButtonText, { color: colors.text }]}
                  >
                    View Orders
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
