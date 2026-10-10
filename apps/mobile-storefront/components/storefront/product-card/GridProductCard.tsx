import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { Platform, Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Colors, { BRAND, withAlpha } from '@/constants/Colors';
import { formatProductConditionDisplay } from '@/types/product';
import { getProductCardShadowStyles } from '../ProductCard.shadows';
import styles from '../ProductCard.styles';
import { formatSearchCardPrice } from './search-price';
import type { GridProductCardProps } from './types';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function GridProductCard({
  product,
  imageSource,
  imageProps,
  showLocalPlaceholder,
  handlePress,
  handleAnimateIn,
  handleAnimateOut,
  handleWishlistPress,
  handleAddToCart,
  isSaved,
  cartItemCount,
  animatedStyle,
  heartAnimatedStyle,
  gridWidth,
  shadowColor,
  colors = Colors.light,
}: GridProductCardProps) {
  const rating = product.rating;
  const conditionLabel = formatProductConditionDisplay(product.condition);
  const conditionBadgeColors =
    conditionLabel === 'New'
      ? {
          backgroundColor: colors.success,
          color: colors.background,
        }
      : {
          backgroundColor: BRAND.primary,
          color: colors.background,
        };
  const cardShadowStyles = getProductCardShadowStyles(
    Platform.OS === 'web' ? 'web' : 'native',
    shadowColor,
    colors.black
  );

  return (
    <AnimatedPressable
      style={[
        styles.gridContainer,
        cardShadowStyles.gridContainer,
        {
          width: gridWidth,
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
        animatedStyle,
      ]}
      onPress={handlePress}
      onPressIn={handleAnimateIn}
      onPressOut={handleAnimateOut}
      accessibilityLabel={`${product.name}, ${formatSearchCardPrice(product)}`}
      accessibilityRole="button"
    >
      <View style={[styles.imageWrapper, { backgroundColor: colors.muted }]}>
        <Pressable
          onPress={handleWishlistPress}
          style={styles.wishlistBtn}
          hitSlop={8}
          accessibilityLabel={
            isSaved
              ? `Remove ${product.name} from saved items`
              : `Save ${product.name} for later`
          }
          accessibilityRole="button"
          accessibilityState={{ checked: isSaved }}
        >
          <Animated.View
            testID="grid-wishlist-surface"
            style={[
              heartAnimatedStyle,
              styles.wishlistBlur,
              { backgroundColor: withAlpha(colors.card, 0.8) },
            ]}
          >
            <Ionicons
              name={isSaved ? 'heart' : 'heart-outline'}
              size={16}
              color={isSaved ? colors.destructive : colors.mutedForeground}
            />
          </Animated.View>
        </Pressable>

        {conditionLabel && (
          <View
            style={[
              styles.badgeContainer,
              { backgroundColor: conditionBadgeColors.backgroundColor },
            ]}
          >
            <Text
              style={[styles.badgeText, { color: conditionBadgeColors.color }]}
            >
              {conditionLabel}
            </Text>
          </View>
        )}

        {showLocalPlaceholder ? (
          <View
            style={[
              styles.gridImage,
              styles.imagePlaceholder,
              { backgroundColor: colors.muted },
            ]}
            accessibilityLabel={`No image available for ${product.name}`}
            testID="grid-product-placeholder"
          >
            <Ionicons
              name="image-outline"
              size={40}
              color={colors.mutedForeground}
            />
          </View>
        ) : (
          <Image
            {...imageProps}
            source={imageSource}
            style={styles.gridImage}
            accessibilityLabel={`${product.name} image`}
            testID="grid-product-image"
          />
        )}

        <Pressable
          onPress={handleAddToCart}
          style={[
            styles.floatingCartBtn,
            cardShadowStyles.floatingCartBtn,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
          accessibilityLabel={`Add ${product.name} to cart`}
          accessibilityRole="button"
        >
          <Ionicons name="cart" size={18} color={BRAND.primary} />
          {cartItemCount > 0 && (
            <View style={[styles.cartBadge, { borderColor: colors.card }]}>
              <Text style={[styles.badgeTextMini, { color: BRAND.onPrimary }]}>
                {cartItemCount}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      <View style={styles.gridContent}>
        {rating != null ? (
          <View
            style={styles.ratingRowMini}
            accessible
            accessibilityLabel={`${rating} out of 5 stars`}
          >
            {[1, 2, 3, 4, 5].map((star) => (
              <Ionicons
                key={star}
                name={star <= Math.floor(rating) ? 'star' : 'star-outline'}
                size={10}
                color={BRAND.secondary}
              />
            ))}
            <Text
              style={[styles.ratingTextMini, { color: colors.mutedForeground }]}
            >
              ({rating})
            </Text>
          </View>
        ) : (
          <View
            style={styles.ratingRowMini}
            accessible
            accessibilityLabel="No ratings"
          >
            <Text
              style={[styles.ratingTextMini, { color: colors.mutedForeground }]}
            >
              No ratings
            </Text>
          </View>
        )}

        <Text
          style={[styles.gridName, { color: colors.text }]}
          numberOfLines={2}
        >
          {product.name}
        </Text>

        <View style={[styles.priceRow, { borderTopColor: colors.border }]}>
          <Text style={[styles.gridPrice, { color: BRAND.primary }]}>
            {formatSearchCardPrice(product)}
          </Text>
          <Text style={[styles.detailsText, { color: colors.text }]}>
            Details
          </Text>
        </View>
      </View>
    </AnimatedPressable>
  );
}
