import Ionicons from '@react-native-vector-icons/ionicons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Image } from 'expo-image';
import type { Ref } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, Layout } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AdSlot } from '@/components/ads/AdSlot';
import { BLURHASH_VARIANTS } from '@/components/storefront/ProductCard';
import type Colors from '@/constants/Colors';
import { SPACING } from '@/constants/Colors';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import type { SavedItem } from '@/stores/saved-store';
import { formatPrice, getDiscountPercentage } from '@/types/product';
import { styles } from './saved-items.styles';

interface SavedItemsViewProps {
  colors: typeof Colors.light;
  items: SavedItem[];
  listRef?: Ref<FlashListRef<SavedItem>>;
  onAddToCart: (item: SavedItem) => void;
  onBrowseProducts: () => void;
  onClearAll: () => void;
  onProductPress: (item: SavedItem) => void;
  onRemove: (item: SavedItem) => void;
}

interface SavedItemCardProps {
  colors: typeof Colors.light;
  item: SavedItem;
  onAddToCart: (item: SavedItem) => void;
  onProductPress: (item: SavedItem) => void;
  onRemove: (item: SavedItem) => void;
}

function formatSavedDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
  });
}

function SavedItemCard({
  colors,
  item,
  onAddToCart,
  onProductPress,
  onRemove,
}: SavedItemCardProps) {
  const discountPercentage = getDiscountPercentage(
    item.price,
    item.compare_at_price
  );

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      layout={Layout.springify()}
      style={[styles.itemCard, { backgroundColor: colors.card }]}
    >
      <Pressable
        accessibilityLabel={`View ${item.name}`}
        accessibilityRole="button"
        onPress={() => onProductPress(item)}
        style={styles.itemContent}
      >
        <View
          style={[styles.imageContainer, { backgroundColor: colors.muted }]}
        >
          <Image
            source={createSafeBoundedImageSource({
              fit: 'cover',
              height: 100,
              uri: item.image,
              width: 100,
            })}
            style={styles.image}
            contentFit="cover"
            placeholder={{ blurhash: BLURHASH_VARIANTS.default }}
            transition={200}
            cachePolicy="memory-disk"
            autoplay={false}
          />
          {discountPercentage !== null && discountPercentage > 0 ? (
            <View
              style={[
                styles.discountBadge,
                { backgroundColor: colors.primary },
              ]}
            >
              <Text
                style={[
                  styles.discountText,
                  { color: colors.primaryForeground },
                ]}
              >
                -{discountPercentage}%
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.infoContainer}>
          {item.brand && (
            <Text style={[styles.brandText, { color: colors.textSecondary }]}>
              {item.brand}
            </Text>
          )}
          <Text
            style={[styles.nameText, { color: colors.text }]}
            numberOfLines={2}
          >
            {item.name}
          </Text>

          <View style={styles.priceRow}>
            <Text style={[styles.priceText, { color: colors.price }]}>
              {formatPrice(item.price)}
            </Text>
            {item.compare_at_price && (
              <Text
                style={[
                  styles.comparePriceText,
                  { color: colors.textSecondary },
                ]}
              >
                {formatPrice(item.compare_at_price)}
              </Text>
            )}
          </View>

          <Text style={[styles.savedDateText, { color: colors.textSecondary }]}>
            Saved {formatSavedDate(item.savedAt)}
          </Text>
        </View>
      </Pressable>

      <View style={styles.actionsRow}>
        <Pressable
          accessibilityLabel={`Remove ${item.name} from saved items`}
          accessibilityRole="button"
          style={[
            styles.actionButton,
            styles.removeButton,
            { borderColor: colors.border },
          ]}
          onPress={() => onRemove(item)}
        >
          <Ionicons
            name="heart-dislike-outline"
            size={18}
            color={colors.textSecondary}
          />
          <Text
            style={[styles.actionButtonText, { color: colors.textSecondary }]}
          >
            Remove
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`Add ${item.name} to cart`}
          accessibilityRole="button"
          style={[styles.actionButton, { backgroundColor: colors.primary }]}
          onPress={() => onAddToCart(item)}
        >
          <Ionicons
            name="cart-outline"
            size={18}
            color={colors.primaryForeground}
          />
          <Text
            style={[
              styles.actionButtonText,
              { color: colors.primaryForeground },
            ]}
          >
            Add to Cart
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

export function SavedItemsView({
  colors,
  items,
  listRef,
  onAddToCart,
  onBrowseProducts,
  onClearAll,
  onProductPress,
  onRemove,
}: SavedItemsViewProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlashList
        ref={listRef}
        data={items}
        renderItem={({ item }) => (
          <SavedItemCard
            colors={colors}
            item={item}
            onAddToCart={onAddToCart}
            onProductPress={onProductPress}
            onRemove={onRemove}
          />
        )}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          items.length === 0 && styles.emptyListContent,
          { paddingBottom: insets.bottom + SPACING.lg },
        ]}
        ListHeaderComponent={() =>
          items.length > 0 ? (
            <View style={styles.listHeader}>
              <Text
                style={[styles.itemCountText, { color: colors.textSecondary }]}
              >
                {items.length} {items.length === 1 ? 'item' : 'items'} saved
              </Text>
              <Pressable
                accessibilityLabel="Clear saved items"
                accessibilityRole="button"
                onPress={onClearAll}
              >
                <Text style={[styles.clearAllText, { color: colors.primary }]}>
                  Clear All
                </Text>
              </Pressable>
            </View>
          ) : null
        }
        ListEmptyComponent={() => (
          <View style={styles.emptyState}>
            <Ionicons
              name="heart-outline"
              size={80}
              color={colors.textSecondary}
            />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No saved items
            </Text>
            <Text
              style={[styles.emptySubtitle, { color: colors.textSecondary }]}
            >
              Tap the heart icon on products to save them for later
            </Text>
            <Pressable
              accessibilityLabel="Browse Products"
              accessibilityRole="button"
              style={[styles.shopButton, { backgroundColor: colors.primary }]}
              onPress={onBrowseProducts}
            >
              <Text
                style={[
                  styles.shopButtonText,
                  { color: colors.primaryForeground },
                ]}
              >
                Browse Products
              </Text>
            </Pressable>
            <AdSlot placement="FOOTER_ANCHOR" />
          </View>
        )}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}
