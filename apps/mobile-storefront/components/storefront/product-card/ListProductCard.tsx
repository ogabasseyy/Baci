import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { sanitizeDescriptionPlainText } from '@/components/storefront/utils/text';
import Colors, { BRAND } from '@/constants/Colors';
import styles from '../ProductCard.styles';
import { formatSearchCardPrice } from './search-price';
import type { ListProductCardProps } from './types';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function ListProductCard({
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
  colors = Colors.light,
}: ListProductCardProps) {
  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handleAnimateIn}
      onPressOut={handleAnimateOut}
      style={[
        styles.listContainer,
        { backgroundColor: colors.card, borderColor: colors.border },
        animatedStyle,
      ]}
      accessibilityLabel={`${product.name}, ${formatSearchCardPrice(product)}`}
      accessibilityRole="button"
    >
      {showLocalPlaceholder ? (
        <View
          style={[
            styles.listImage,
            styles.imagePlaceholder,
            { backgroundColor: colors.muted },
          ]}
          testID="list-product-placeholder"
        >
          <Ionicons
            name="image-outline"
            size={32}
            color={colors.mutedForeground}
          />
        </View>
      ) : (
        <Image
          {...imageProps}
          source={imageSource}
          style={[styles.listImage, { backgroundColor: colors.muted }]}
          testID="list-product-image"
        />
      )}
      <View style={styles.listContent}>
        <View style={styles.ratingRowMini}>
          {[1, 2, 3, 4, 5].map((star) => (
            <Ionicons
              key={star}
              name={
                star <= Math.floor(product.rating || 0)
                  ? 'star'
                  : 'star-outline'
              }
              size={10}
              color={BRAND.secondary}
            />
          ))}
        </View>

        <Text
          style={[styles.listName, { color: colors.text }]}
          numberOfLines={1}
        >
          {product.name}
        </Text>

        {product.description && (
          <Text
            style={[styles.listDescription, { color: colors.mutedForeground }]}
            numberOfLines={2}
          >
            {sanitizeDescriptionPlainText(product.description).substring(
              0,
              100
            )}
          </Text>
        )}

        <View style={styles.listFooter}>
          <Text style={[styles.listPrice, { color: BRAND.primary }]}>
            {formatSearchCardPrice(product)}
          </Text>
          <Pressable
            onPress={handleAddToCart}
            style={[styles.listCartBtn, { backgroundColor: colors.text }]}
            hitSlop={8}
            accessibilityLabel={`Add ${product.name} to cart`}
            accessibilityRole="button"
          >
            <View style={{ position: 'relative' }}>
              <Ionicons name="cart" size={16} color={colors.background} />
              {cartItemCount > 0 && (
                <View style={[styles.listBadge, { borderColor: colors.card }]}>
                  <Text
                    style={[styles.badgeTextMini, { color: BRAND.onPrimary }]}
                  >
                    {cartItemCount}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.listCartLabel, { color: colors.background }]}>
              Add
            </Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        onPress={handleWishlistPress}
        style={styles.listWishlistBtn}
        hitSlop={8}
        accessibilityLabel={
          isSaved
            ? `Remove ${product.name} from saved items`
            : `Save ${product.name} for later`
        }
        accessibilityRole="button"
        accessibilityState={{ checked: isSaved }}
      >
        <Ionicons
          name={isSaved ? 'heart' : 'heart-outline'}
          size={18}
          color={isSaved ? colors.secondary : colors.mutedForeground}
        />
      </Pressable>
    </AnimatedPressable>
  );
}
