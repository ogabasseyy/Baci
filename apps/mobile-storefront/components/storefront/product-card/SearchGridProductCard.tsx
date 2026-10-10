import { requiresProductSelection } from '@baci/shared/lib';
import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Colors from '@/constants/Colors';
import { formatProductConditionDisplay } from '@/types/product';
import { formatSearchCardPrice } from './search-price';
import type { GridProductCardProps } from './types';

export default function SearchGridProductCard(props: GridProductCardProps) {
  const { product, colors = Colors.light, footer } = props;
  const condition = formatProductConditionDisplay(
    product.searchMatch?.condition ?? product.condition
  );
  const specs = product.specifications;
  // A variant match prices and links the matched option, but refined
  // hydration omits variants — so parent storage/RAM would misdescribe
  // the advertised option (128 GB price beside a 256 GB subtitle).
  // Suppress the parent specs until variant detail is available.
  const detail = product.searchMatch?.variantId
    ? ''
    : [specs?.storage, specs?.ram].filter(Boolean).join(' · ');
  const needsOptions =
    requiresProductSelection(product) || !!product.searchMatch;
  return (
    <Animated.View
      style={[
        styles.card,
        {
          width: props.gridWidth,
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
        props.animatedStyle,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${product.name}, ${formatSearchCardPrice(product)}`}
        onPress={props.handlePress}
        onPressIn={props.handleAnimateIn}
        onPressOut={props.handleAnimateOut}
      >
        <View style={[styles.imageArea, { backgroundColor: colors.muted }]}>
          {props.showLocalPlaceholder ? (
            <View
              style={styles.placeholder}
              accessibilityLabel={`No image available for ${product.name}`}
            >
              <Ionicons
                name="image-outline"
                size={32}
                color={colors.textSecondary}
              />
            </View>
          ) : (
            <Image
              {...props.imageProps}
              source={props.imageSource}
              contentFit="contain"
              style={styles.image}
              accessibilityLabel={`${product.name} image`}
            />
          )}
          {condition && (
            <View style={[styles.condition, { backgroundColor: colors.card }]}>
              <Text
                style={{ fontSize: 10, fontWeight: '500', color: colors.text }}
              >
                {condition}
              </Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              props.isSaved
                ? `Remove ${product.name} from saved items`
                : `Save ${product.name} for later`
            }
            accessibilityState={{ checked: props.isSaved }}
            onPress={(event) => {
              event?.stopPropagation();
              props.handleWishlistPress();
            }}
            style={styles.save}
          >
            <Ionicons
              name={props.isSaved ? 'heart' : 'heart-outline'}
              size={19}
              color={props.isSaved ? colors.destructive : colors.text}
            />
          </Pressable>
        </View>
        <View style={styles.content}>
          <Text numberOfLines={2} style={[styles.name, { color: colors.text }]}>
            {product.name}
          </Text>
          {!!detail && (
            <Text
              numberOfLines={1}
              style={[styles.detail, { color: colors.textSecondary }]}
            >
              {detail}
            </Text>
          )}
          {product.rating != null && product.rating > 0 && (
            <View style={styles.rating}>
              <Ionicons name="star" size={11} color={colors.primary} />
              <Text style={[styles.detail, { color: colors.textSecondary }]}>
                {product.rating.toFixed(1)}
                {product.review_count ? ` (${product.review_count})` : ''}
              </Text>
            </View>
          )}
          <Text style={[styles.price, { color: colors.text }]}>
            {formatSearchCardPrice(product)}
          </Text>
        </View>
      </Pressable>
      <View style={[styles.footer, { borderColor: colors.border }]}>
        <View style={{ flex: 1 }}>{footer}</View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            needsOptions
              ? `Choose options for ${product.name}`
              : `Add ${product.name} to cart`
          }
          onPress={props.handleAddToCart}
          style={[styles.buy, { backgroundColor: colors.muted }]}
        >
          {needsOptions ? (
            <Text
              style={{
                fontSize: 11,
                fontWeight: '500',
                color: colors.text,
                textAlign: 'center',
              }}
            >
              Choose options
            </Text>
          ) : (
            <Ionicons name="add" size={22} color={colors.text} />
          )}
          {!needsOptions && props.cartItemCount > 0 && (
            <Text style={{ fontSize: 10, color: colors.textSecondary }}>
              {props.cartItemCount} in cart
            </Text>
          )}
        </Pressable>
      </View>
    </Animated.View>
  );
}
const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  imageArea: { aspectRatio: 1, position: 'relative' },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  condition: {
    position: 'absolute',
    left: 8,
    top: 10,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  save: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: 12, gap: 5 },
  name: { fontSize: 13, lineHeight: 18, minHeight: 36, fontWeight: '500' },
  detail: { fontSize: 11 },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  price: { fontSize: 16, fontWeight: '700', marginTop: 3 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 10,
    paddingVertical: 6,
    gap: 4,
  },
  buy: {
    minWidth: 44,
    minHeight: 44,
    maxWidth: 72,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
