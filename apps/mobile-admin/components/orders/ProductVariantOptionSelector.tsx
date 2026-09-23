import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Text, View } from 'react-native';
import type { SelectedParentProduct } from '@/components/orders/new-order.types';
import type { ThemeColors } from '@/constants/theme';
import type { AdminProductVariant } from '@/lib/product-picker-variant-rows';
import type { VariantOptionGroup } from '@/lib/product-variant-option-selector';
import { ProductVariantSelectableGroup } from './ProductVariantSelectableGroup';
import { styles } from './product-variant-option-selector.styles';

interface ProductVariantOptionSelectorProps {
  colors: Pick<
    ThemeColors,
    | 'backgroundLight'
    | 'border'
    | 'card'
    | 'error'
    | 'primary'
    | 'text'
    | 'textMuted'
    | 'textOnPrimary'
    | 'textSecondary'
  >;
  formatPrice: (amount: number) => string;
  onSelect: (key: string, value: string) => void;
  parentProduct: NonNullable<SelectedParentProduct>;
  selectedVariant: AdminProductVariant | null;
  variantOptionGroups: VariantOptionGroup[];
}

export function ProductVariantOptionSelector({
  colors,
  formatPrice,
  onSelect,
  parentProduct,
  selectedVariant,
  variantOptionGroups,
}: ProductVariantOptionSelectorProps) {
  const displayPrice = selectedVariant?.price ?? parentProduct.price;
  const selectableGroups = variantOptionGroups.filter(
    (group) => group.values.length > 1
  );

  return (
    <View style={styles.container}>
      <View
        style={[styles.productHeader, { borderBottomColor: colors.border }]}
      >
        <Text
          numberOfLines={2}
          style={[styles.productName, { color: colors.text }]}
        >
          {parentProduct.name}
        </Text>
        <Text style={[styles.productPrice, { color: colors.textSecondary }]}>
          {formatPrice(displayPrice)}
        </Text>
      </View>

      <BottomSheetScrollView
        contentContainerStyle={styles.groups}
        style={styles.optionsScroll}
        testID="variant-option-scroll-view"
      >
        {selectableGroups.map((group) => {
          return (
            <ProductVariantSelectableGroup
              colors={colors}
              group={group}
              key={group.key}
              onSelect={onSelect}
              values={group.values}
            />
          );
        })}
      </BottomSheetScrollView>
    </View>
  );
}
