/**
 * Product Comparison Screen
 * Side-by-side comparison of up to 3 products
 */

import { router } from 'expo-router';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { CompareView } from '@/components/compare/CompareView';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useComparisonProducts } from '@/hooks/use-comparison-products';
import { useComparisonStore } from '@/stores/comparison-store';
import type { Product } from '@/types/product';

export default function CompareScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  const { products, removeProduct, clearComparison } = useComparisonStore(
    useShallow((state) => ({
      products: state.products,
      removeProduct: state.removeProduct,
      clearComparison: state.clearComparison,
    }))
  );
  const fresh = useComparisonProducts(products);
  const openProduct = (product: Product) =>
    router.push({
      pathname: '/product/[slug]',
      params: {
        slug: product.slug,
        ...(product.searchMatch?.variantId
          ? { variant_id: product.searchMatch.variantId }
          : {}),
        ...(product.searchMatch?.offerId
          ? { offer_id: product.searchMatch.offerId }
          : {}),
        ...(product.searchMatch?.condition
          ? { condition: product.searchMatch.condition }
          : {}),
      },
    });

  // Collect all unique spec keys across all products
  const allSpecKeys = (() => {
    const keys = new Set<string>();
    for (const product of fresh.products) {
      if (product.specifications) {
        for (const key of Object.keys(product.specifications)) {
          keys.add(key);
        }
      }
    }
    return Array.from(keys);
  })();

  return (
    <>
      <Text
        accessibilityLiveRegion="polite"
        style={{
          color: colors.textSecondary,
          paddingHorizontal: 16,
          paddingTop: 12,
        }}
      >
        {fresh.status}
      </Text>
      <CompareView
        allSpecKeys={allSpecKeys}
        bottomInset={insets.bottom}
        colors={colors}
        onAddToCart={openProduct}
        onBrowseProducts={() => router.push('/')}
        onClearComparison={clearComparison}
        onOpenProduct={openProduct}
        onRemoveProduct={removeProduct}
        products={fresh.products}
        unavailableIds={fresh.unavailableIds}
      />
    </>
  );
}
