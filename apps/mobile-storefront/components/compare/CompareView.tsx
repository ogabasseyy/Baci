import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND, SPACING } from '@/constants/Colors';
import type { Product } from '@/types/product';
import { CompareTable } from './CompareTable';
import { compareStyles as styles } from './compare.styles';

interface CompareViewProps {
  allSpecKeys: string[];
  bottomInset: number;
  colors: typeof Colors.light;
  onAddToCart: (product: Product) => void;
  onBrowseProducts: () => void;
  onClearComparison: () => void;
  onOpenProduct: (product: Product) => void;
  onRemoveProduct: (productId: string) => void;
  products: Product[];
  // Required (see CompareTable): the hook ids must flow explicitly so a
  // forgotten prop can never render a fallback zero as a real price.
  unavailableIds: string[];
}

export function CompareView({
  allSpecKeys,
  bottomInset,
  colors,
  onAddToCart,
  onBrowseProducts,
  onClearComparison,
  onOpenProduct,
  onRemoveProduct,
  products,
  unavailableIds,
}: CompareViewProps) {
  if (products.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen
          options={{
            title: 'Compare Products',
            headerBackButtonDisplayMode: 'minimal',
            headerStyle: { backgroundColor: colors.card },
            headerTintColor: colors.text,
          }}
        />
        <View style={styles.emptyState}>
          <Ionicons
            name="git-compare-outline"
            size={80}
            color={colors.textSecondary}
          />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No products to compare
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Add products to compare their features and prices
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Browse Products"
            style={[styles.browseButton, { backgroundColor: BRAND.primary }]}
            onPress={onBrowseProducts}
          >
            <Text style={styles.browseButtonText}>Browse Products</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: `Compare (${products.length})`,
          headerBackButtonDisplayMode: 'minimal',
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
        }}
      />
      <View
        testID="comparison-clear-row"
        style={{ alignItems: 'center', paddingVertical: 8 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear comparison"
          onPress={onClearComparison}
          style={{
            minHeight: 44,
            paddingHorizontal: 20,
            justifyContent: 'center',
          }}
        >
          <Text style={[styles.clearButtonText, { color: BRAND.primary }]}>
            Clear all
          </Text>
        </Pressable>
      </View>
      <ScrollView
        testID="comparison-vertical-scroll"
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: bottomInset + SPACING.lg }}
      >
        <CompareTable
          allSpecKeys={allSpecKeys}
          bottomInset={bottomInset}
          colors={colors}
          onAddToCart={onAddToCart}
          onOpenProduct={onOpenProduct}
          onRemoveProduct={onRemoveProduct}
          products={products}
          unavailableIds={unavailableIds}
        />
      </ScrollView>
    </View>
  );
}
