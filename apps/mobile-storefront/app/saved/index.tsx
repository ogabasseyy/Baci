/**
 * Saved Items (Wishlist) Screen
 * Displays user's saved/favorited products
 */

import { requiresProductSelection } from '@baci/shared/lib';
import type { FlashListRef } from '@shopify/flash-list';
import { router, Stack } from 'expo-router';
import { useRef } from 'react';
import { Alert } from 'react-native';
import { SavedItemsView } from '@/components/saved/SavedItemsView';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useCartStore } from '@/stores/cart-store';
import { type SavedItem, useSavedStore } from '@/stores/saved-store';

// Forwards a saved search match's option identity to the PDP so the
// displayed selection matches the saved price basis; plain string href
// when no match basis was persisted (mirrors search.tsx PDP nav).
const buildProductHref = (item: SavedItem) => {
  if (!item.match_variant_id && !item.match_offer_id && !item.match_condition) {
    return `/product/${item.slug}`;
  }
  // An exact option id resolves its own live condition on the PDP. A
  // persisted snapshot condition can be stale (the merchant reconditioned
  // the option after saving) and would poison the match: the offer
  // resolver would reject the identified offer and fall through to a
  // different offer still carrying the old condition.
  const hasExactIdentity = Boolean(
    item.match_variant_id || item.match_offer_id
  );
  // Match fields persist only from searchMatch, so a condition without
  // ids is a base-row match: carry the base identity (mirroring search
  // nav) so the PDP keeps the saved base price instead of resolving a
  // same-condition offer.
  const isBaseRowMatch = !hasExactIdentity && item.match_condition;
  return {
    pathname: '/product/[slug]',
    params: {
      slug: item.slug,
      ...(item.match_variant_id ? { variant_id: item.match_variant_id } : {}),
      ...(item.match_offer_id ? { offer_id: item.match_offer_id } : {}),
      ...(isBaseRowMatch ? { condition: item.match_condition } : {}),
      ...(isBaseRowMatch ? { match_base: '1' } : {}),
    },
  } as const;
};

const handleProductPress = (item: SavedItem): void => {
  if (!item.slug) return;
  router.push(buildProductHref(item));
};

export default function SavedItemsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const items = useSavedStore((state) => state.items);
  const removeItem = useSavedStore((state) => state.removeItem);
  const clearSaved = useSavedStore((state) => state.clearSaved);
  const addToCart = useCartStore((state) => state.addItem);
  const flashListRef = useRef<FlashListRef<SavedItem>>(null);

  const handleRemove = (item: SavedItem) => {
    Alert.alert('Remove Item', `Remove "${item.name}" from saved items?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          flashListRef.current?.prepareForLayoutAnimationRender();
          removeItem(item.product_id);
        },
      },
    ]);
  };

  const handleClearAll = () => {
    Alert.alert(
      'Clear Saved Items',
      'Are you sure you want to remove all saved items?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => {
            flashListRef.current?.prepareForLayoutAnimationRender();
            clearSaved();
          },
        },
      ]
    );
  };

  const handleAddToCart = (item: SavedItem) => {
    if (
      requiresProductSelection(
        {
          available_conditions: item.available_conditions,
          has_condition_offers: item.has_condition_offers,
          has_variants: item.has_variants,
          variant_model: item.variant_model,
        },
        { metadataTrust: 'legacy-saved-record' }
      )
    ) {
      if (item.slug) {
        router.push(buildProductHref(item));
      }
      return;
    }

    addToCart({
      product_id: item.product_id,
      slug: item.slug,
      name: item.name,
      price: item.price,
      compare_at_price: item.compare_at_price,
      quantity: 1,
      image_url: item.image,
      condition: item.condition,
    });
    Alert.alert('Added to Cart', `${item.name} has been added to your cart`);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Saved Items',
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
          headerShadowVisible: false,
        }}
      />
      <SavedItemsView
        colors={colors}
        items={items}
        listRef={flashListRef}
        onAddToCart={handleAddToCart}
        onBrowseProducts={() => router.push('/')}
        onClearAll={handleClearAll}
        onProductPress={handleProductPress}
        onRemove={handleRemove}
      />
    </>
  );
}
