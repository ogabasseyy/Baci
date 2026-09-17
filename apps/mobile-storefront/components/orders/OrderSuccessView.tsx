import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AdSlot } from '@/components/ads/AdSlot';
import { GoogleLogo } from '@/components/icons/GoogleLogo';
import { SuccessIcon } from '@/components/icons/SuccessIcon';
import { PermissionModal } from '@/components/ui/PermissionModal';
import Colors, { BRAND } from '@/constants/Colors';
import type { OrderSuccessViewProps } from './OrderSuccessView.types';
import { orderSuccessStyles as styles } from './order-success.styles';
import {
  getOrderSuccessDeliveryLabel,
  getOrderSuccessTone,
  resolveOrderSuccessDeliveryEstimate,
} from './order-success-content';

export function OrderSuccessView({
  colors,
  deliveryEstimate,
  isDark,
  onContinueShopping,
  onLeaveGoogleReview,
  onPermissionDeny,
  onPermissionGrant,
  onViewDocument,
  onViewOrders,
  orderNumber,
  paymentMethod,
  reference,
  isDocumentLoading = false,
  showPermissionModal,
}: OrderSuccessViewProps) {
  const resolvedDeliveryEstimate =
    resolveOrderSuccessDeliveryEstimate(deliveryEstimate);
  const successTone = getOrderSuccessTone(paymentMethod);

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
              <SuccessIcon size={84} color={colors.success} />
            </View>
            <View
              style={[
                styles.eyebrowPill,
                {
                  backgroundColor: isDark
                    ? 'rgba(217, 59, 48, 0.16)'
                    : 'rgba(217, 59, 48, 0.08)',
                },
              ]}
            >
              <Text style={styles.eyebrowText}>{successTone.eyebrow}</Text>
            </View>
            <Text style={[styles.title, { color: colors.text }]}>
              {successTone.title}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {successTone.subtitle}
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
              <View
                style={[styles.divider, { backgroundColor: colors.border }]}
              />
              <View style={styles.orderRow}>
                <Ionicons name="time-outline" size={18} color={BRAND.primary} />
                <Text
                  style={[styles.orderLabel, { color: colors.textSecondary }]}
                >
                  {getOrderSuccessDeliveryLabel(deliveryEstimate)}
                </Text>
                <Text style={[styles.orderValue, { color: colors.text }]}>
                  {resolvedDeliveryEstimate}
                </Text>
              </View>
              {reference ? (
                <>
                  <View
                    style={[styles.divider, { backgroundColor: colors.border }]}
                  />
                  <View style={styles.orderRow}>
                    <Ionicons
                      name="card-outline"
                      size={18}
                      color={BRAND.primary}
                    />
                    <Text
                      style={[
                        styles.orderLabel,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Payment Ref
                    </Text>
                    <Text style={[styles.orderValue, { color: colors.text }]}>
                      {reference}
                    </Text>
                  </View>
                </>
              ) : null}
            </View>
            <View style={styles.nextSteps}>
              <Text style={[styles.nextTitle, { color: colors.text }]}>
                What happens next
              </Text>
              <View
                style={[
                  styles.nextStepCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={styles.stepIconWrap}>
                  <Ionicons
                    name="receipt-outline"
                    size={18}
                    color={BRAND.primary}
                  />
                </View>
                <View style={styles.nextStepBody}>
                  <Text style={[styles.nextStepTitle, { color: colors.text }]}>
                    {successTone.nextDocumentTitle}
                  </Text>
                  <Text
                    style={[
                      styles.nextStepText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {successTone.nextDocumentText}
                  </Text>
                </View>
              </View>
              <View
                style={[
                  styles.nextStepCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={styles.stepIconWrap}>
                  <Ionicons
                    name="cube-outline"
                    size={18}
                    color={BRAND.primary}
                  />
                </View>
                <View style={styles.nextStepBody}>
                  <Text style={[styles.nextStepTitle, { color: colors.text }]}>
                    Processing & delivery
                  </Text>
                  <Text
                    style={[
                      styles.nextStepText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Your order will be prepared and you can track it in real
                    time.
                  </Text>
                </View>
              </View>
            </View>
            <View style={styles.actions}>
              {onViewDocument ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={successTone.documentLabel}
                  accessibilityState={{ disabled: isDocumentLoading }}
                  disabled={isDocumentLoading}
                  style={[
                    styles.documentButton,
                    {
                      backgroundColor: BRAND.primary,
                      opacity: isDocumentLoading ? 0.72 : 1,
                    },
                  ]}
                  onPress={onViewDocument}
                >
                  <Ionicons
                    name="document-text-outline"
                    size={18}
                    color={Colors.light.white}
                  />
                  <Text style={styles.documentButtonText}>
                    {isDocumentLoading
                      ? 'Preparing document...'
                      : successTone.documentLabel}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Leave a Google Review"
                style={[
                  styles.reviewButton,
                  { backgroundColor: BRAND.primary },
                ]}
                onPress={onLeaveGoogleReview}
              >
                <View style={styles.googleLogoWrap}>
                  <GoogleLogo size={18} />
                </View>
                <Text style={styles.reviewButtonText}>
                  Leave a Google Review
                </Text>
              </Pressable>
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
              <AdSlot placement="ORDER_SUCCESS_BANNER" />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
      <PermissionModal
        visible={showPermissionModal}
        onGrant={onPermissionGrant}
        onDeny={onPermissionDeny}
      />
    </>
  );
}
