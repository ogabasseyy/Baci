import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeImage } from '@/components/ui/SafeImage';
import { DEFAULT_ASSURANCE_RATE } from '@/constants/assurance';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import { PLACEHOLDER_IMAGE_URL } from '@/constants/Images';
import { useMerchantPaymentSettings } from '@/hooks/useMerchantPaymentSettings';
import { isQuizVoucherLine } from '@/lib/cart/quiz-voucher-line';
import { resolveColorSwatchValue } from '@/lib/cart-display';
import {
  getCartItemEffectivePrice,
  hasActiveNegotiatedPrice,
} from '@/lib/cart-pricing';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import type { CartItem } from '@/stores/cart-store';
import AssuranceToggle from './AssuranceToggle';
import CartItemQuantityControls from './CartItemQuantityControls';
import NegotiationButton from './NegotiationButton';
import styles from './styles';

interface CartItemCardProps {
  item: CartItem;
  handleQuantityChange: (item: CartItem, delta: number) => void;
  handleRemoveItem: (item: CartItem) => void;
  toggleAssurance: (itemId: string) => void;
  openItemNegotiation?: (item: CartItem) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  formatPrice: (amount: number) => string;
  colors: (typeof Colors)['light'];
  surfaceInset: string;
  disabledIconColor: string;
  negotiateSurface: string;
  negotiateBorder: string;
}

export default function CartItemCard({
  item,
  handleQuantityChange,
  handleRemoveItem,
  toggleAssurance,
  openItemNegotiation,
  updateQuantity,
  formatPrice,
  colors,
  surfaceInset,
  disabledIconColor,
  negotiateSurface,
  negotiateBorder,
}: CartItemCardProps) {
  // Gate opt-in on the live merchant setting (mirrors web's
  // `(shippingInsuranceEnabled || item.hasAssurance)` line-item gate):
  // checkout prices the fee purely from `hasAssurance` with no
  // server-side setting check, so an ungated toggle would sell
  // insurance the merchant disabled. Assured lines keep the control
  // as an opt-out; unknown fails closed like the add-time default.
  const { data: paymentSettings } = useMerchantPaymentSettings();
  const showAssuranceToggle =
    paymentSettings?.shipping_insurance_enabled === true ||
    item.hasAssurance === true;
  // Voucher-backed lines are pinned to one by the server; their
  // quantity controls are display-only.
  const isVoucherLine = isQuizVoucherLine(item);
  const conditionText = item.condition ?? 'NEW';
  const isNew = conditionText.toLowerCase() === 'new';
  const priceToUse = getCartItemEffectivePrice(item);
  const itemTotal = priceToUse * item.quantity;
  const assuranceCost = item.hasAssurance
    ? Math.round(itemTotal * (item.assuranceRate ?? DEFAULT_ASSURANCE_RATE))
    : 0;
  const colorText =
    item.color ??
    item.variant_attributes?.color ??
    item.variant_attributes?.colour;
  const colorSwatchValue = colorText
    ? resolveColorSwatchValue(colorText)
    : undefined;

  return (
    <View
      style={[
        styles.cartCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.cardTop}>
        <Pressable
          style={[
            styles.imageContainer,
            {
              backgroundColor: surfaceInset,
              borderColor: colors.border,
            },
          ]}
          onPress={() => router.push(`/product/${item.slug}`)}
          accessibilityRole="button"
          accessibilityLabel={`Open product: ${item.name || item.slug || item.product_id}`}
        >
          <SafeImage
            source={createSafeBoundedImageSource({
              height: 64,
              uri: item.image_url || PLACEHOLDER_IMAGE_URL,
              width: 64,
            })}
            style={styles.productImage}
            contentFit="contain"
          />
        </Pressable>

        <View style={styles.productInfo}>
          <Text
            style={[styles.productName, { color: colors.text }]}
            numberOfLines={2}
          >
            {item.name}
          </Text>

          <View style={styles.tagsRow}>
            <View
              style={[
                styles.conditionTag,
                isNew
                  ? [
                      styles.conditionTagNew,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.success,
                      },
                    ]
                  : [
                      styles.conditionTagUsed,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.warning,
                      },
                    ],
              ]}
            >
              <Text
                style={[
                  styles.conditionTagText,
                  isNew
                    ? [styles.conditionTagTextNew, { color: colors.success }]
                    : [styles.conditionTagTextUsed, { color: colors.warning }],
                ]}
              >
                {conditionText}
              </Text>
            </View>
            {colorText && (
              <View
                style={[
                  styles.colorTag,
                  {
                    backgroundColor: surfaceInset,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.colorDot,
                    {
                      backgroundColor: colorSwatchValue || 'transparent',
                      borderColor: colors.border,
                    },
                  ]}
                />
                <Text
                  style={[styles.colorTagText, { color: colors.textSecondary }]}
                >
                  {colorText}
                </Text>
              </View>
            )}
            {item.storage && (
              <View
                style={[
                  styles.storageTag,
                  {
                    backgroundColor: surfaceInset,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.storageTagText,
                    { color: colors.textSecondary },
                  ]}
                >
                  {item.storage}
                </Text>
              </View>
            )}
          </View>
        </View>

        <Pressable
          style={styles.removeButton}
          onPress={() => handleRemoveItem(item)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.name} from cart`}
        >
          <Ionicons name="trash-outline" size={18} color={BRAND.primary} />
        </Pressable>
      </View>

      <View style={[styles.dashedSeparator, { borderColor: colors.border }]} />

      <View style={styles.controlsRow}>
        <CartItemQuantityControls
          item={item}
          isVoucherLine={isVoucherLine}
          handleQuantityChange={handleQuantityChange}
          updateQuantity={updateQuantity}
          textColor={colors.text}
          textSecondaryColor={colors.textSecondary}
          borderColor={colors.border}
          surfaceInset={surfaceInset}
          disabledIconColor={disabledIconColor}
        />
        <View style={styles.priceContainer}>
          {hasActiveNegotiatedPrice(item) ? (
            <>
              <Text
                style={[styles.originalPrice, { color: colors.textSecondary }]}
              >
                {formatPrice(item.price * item.quantity)}
              </Text>
              <Text style={[styles.negotiatedPrice, { color: colors.success }]}>
                {formatPrice(itemTotal)}
              </Text>
            </>
          ) : (
            <Text style={[styles.currentPrice, { color: colors.text }]}>
              {formatPrice(itemTotal)}
            </Text>
          )}
        </View>
      </View>

      <View
        style={[styles.solidSeparator, { backgroundColor: colors.border }]}
      />

      <View style={styles.bottomRow}>
        {showAssuranceToggle ? (
          <AssuranceToggle
            item={item}
            assuranceCost={assuranceCost}
            toggleAssurance={toggleAssurance}
            formatPrice={formatPrice}
            colors={colors}
          />
        ) : null}
        <NegotiationButton
          item={item}
          openItemNegotiation={openItemNegotiation}
          colors={colors}
          negotiateSurface={negotiateSurface}
          negotiateBorder={negotiateBorder}
        />
      </View>
    </View>
  );
}
