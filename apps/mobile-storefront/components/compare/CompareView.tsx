import Ionicons from '@react-native-vector-icons/ionicons';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BLURHASH_VARIANTS } from '@/components/storefront/ProductCard';
import Colors, { BRAND, SPACING } from '@/constants/Colors';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import type { Product } from '@/types/product';
import { formatPrice, formatProductConditionDisplay } from '@/types/product';
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
  unavailableIds?: string[];
}

function LabelCell({
  backgroundColor,
  colors,
  label,
}: {
  backgroundColor: string;
  colors: typeof Colors.light;
  label: string;
}) {
  return (
    <View style={[styles.labelCell, { backgroundColor }]}>
      <Text style={[styles.labelText, { color: colors.textSecondary }]}>
        {label}
      </Text>
    </View>
  );
}

function ValueCell({
  backgroundColor,
  children,
}: {
  backgroundColor: string;
  children: ReactNode;
}) {
  return <View style={[styles.specCell, { backgroundColor }]}>{children}</View>;
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
  unavailableIds = [],
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
        <ScrollView
          testID="comparison-horizontal-scroll"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: bottomInset + SPACING.lg },
          ]}
        >
          <View style={styles.comparisonTable}>
            <View style={styles.productRow}>
              <LabelCell
                backgroundColor={colors.card}
                colors={colors}
                label="Product"
              />
              {products.map((product) => (
                <View
                  key={product.id}
                  style={[styles.productCell, { backgroundColor: colors.card }]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${product.name} from comparison`}
                    style={styles.removeButton}
                    onPress={() => onRemoveProduct(product.id)}
                  >
                    <Ionicons
                      name="close-circle"
                      size={24}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View ${product.name}`}
                    onPress={() => onOpenProduct(product)}
                  >
                    <Image
                      source={createSafeBoundedImageSource({
                        fit: 'cover',
                        height: 140 - SPACING.md * 2,
                        uri:
                          product.image ||
                          'https://placehold.co/400x400/1a1a1a/ffffff?text=P',
                        width: 140 - SPACING.md * 2,
                      })}
                      style={styles.productImage}
                      contentFit="cover"
                      placeholder={{ blurhash: BLURHASH_VARIANTS.default }}
                      autoplay={false}
                    />
                    <Text
                      style={[styles.productName, { color: colors.text }]}
                      numberOfLines={2}
                    >
                      {product.name}
                    </Text>
                    {product.brand ? (
                      <Text
                        style={[
                          styles.productBrand,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {product.brand}
                      </Text>
                    ) : null}
                  </Pressable>
                </View>
              ))}
            </View>
            <View style={styles.specRow}>
              <LabelCell
                backgroundColor={colors.background}
                colors={colors}
                label="Price"
              />
              {products.map((product) => (
                <ValueCell key={product.id} backgroundColor={colors.background}>
                  <Text style={[styles.priceText, { color: BRAND.primary }]}>
                    {unavailableIds.includes(product.id)
                      ? 'Price not verified'
                      : `${!product.searchMatch && (product.has_variants || product.has_condition_offers) ? 'From ' : ''}${formatPrice(product.price)}`}
                  </Text>
                  {!unavailableIds.includes(product.id) &&
                  product.compare_at_price &&
                  product.compare_at_price > product.price ? (
                    <Text
                      style={[
                        styles.comparePriceText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {formatPrice(product.compare_at_price)}
                    </Text>
                  ) : null}
                </ValueCell>
              ))}
            </View>
            <View style={styles.specRow}>
              <LabelCell
                backgroundColor={colors.card}
                colors={colors}
                label="Condition"
              />
              {products.map((product) => (
                <ValueCell key={product.id} backgroundColor={colors.card}>
                  <Text style={[styles.specValue, { color: colors.text }]}>
                    {unavailableIds.includes(product.id)
                      ? 'Option not verified'
                      : formatProductConditionDisplay(product.condition) ||
                        'Unknown'}
                  </Text>
                </ValueCell>
              ))}
            </View>
            <View style={styles.specRow}>
              <LabelCell
                backgroundColor={colors.background}
                colors={colors}
                label="Rating"
              />
              {products.map((product) => (
                <ValueCell key={product.id} backgroundColor={colors.background}>
                  <View style={styles.ratingContainer}>
                    <Ionicons name="star" size={14} color={colors.rating} />
                    <Text style={[styles.specValue, { color: colors.text }]}>
                      {unavailableIds.includes(product.id)
                        ? 'N/A'
                        : product.rating?.toFixed(1) || 'N/A'}
                    </Text>
                  </View>
                </ValueCell>
              ))}
            </View>
            {allSpecKeys.map((specKey, index) => {
              const backgroundColor =
                index % 2 === 0 ? colors.card : colors.background;
              return (
                <View key={specKey} style={styles.specRow}>
                  <LabelCell
                    backgroundColor={backgroundColor}
                    colors={colors}
                    label={specKey}
                  />
                  {products.map((product) => (
                    <ValueCell
                      key={product.id}
                      backgroundColor={backgroundColor}
                    >
                      <Text style={[styles.specValue, { color: colors.text }]}>
                        {unavailableIds.includes(product.id)
                          ? '-'
                          : product.specifications?.[specKey] || '-'}
                      </Text>
                    </ValueCell>
                  ))}
                </View>
              );
            })}
            <View style={styles.specRow}>
              <LabelCell
                backgroundColor={colors.card}
                colors={colors}
                label="Action"
              />
              {products.map((product) => (
                <View
                  key={product.id}
                  style={[styles.actionCell, { backgroundColor: colors.card }]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View options for ${product.name}`}
                    style={[
                      styles.addToCartButton,
                      { backgroundColor: BRAND.primary },
                    ]}
                    onPress={() => onAddToCart(product)}
                  >
                    <Ionicons
                      name="cart-outline"
                      size={16}
                      color={Colors.light.white}
                    />
                    <Text style={styles.addToCartText}>View options</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );
}
