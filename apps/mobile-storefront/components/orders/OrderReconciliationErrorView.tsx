import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { orderSuccessStyles as styles } from '@/components/orders/order-success.styles';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';

interface OrderReconciliationErrorViewProps {
  colors: typeof Colors.light;
  isDark: boolean;
  orderNumber?: string;
  onRetry: () => void;
  onContinueShopping: () => void;
}

/**
 * Bounded verification retries spent while the lookup stayed inconclusive
 * (e.g. a network/API outage). Fail-closed: renders neither the success
 * banner (the param is still unverified) nor the reconciliation state —
 * just an explicit error with a manual retry trigger.
 */
export function OrderReconciliationErrorView({
  colors,
  isDark,
  orderNumber,
  onRetry,
  onContinueShopping,
}: OrderReconciliationErrorViewProps) {
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
                name="cloud-offline-outline"
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
              <Text style={styles.eyebrowText}>Verification unavailable</Text>
            </View>
            <Text style={[styles.title, { color: colors.text }]}>
              Couldn&apos;t verify this order
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              We couldn&apos;t confirm this payment link right now — please
              check your connection and try again. Nothing was assumed about
              this order.
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
                  accessibilityLabel="Retry verification"
                  style={[
                    styles.secondaryButton,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                  onPress={onRetry}
                >
                  <Text
                    style={[styles.secondaryButtonText, { color: colors.text }]}
                  >
                    Try Again
                  </Text>
                </Pressable>
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
              </View>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}
