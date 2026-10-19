import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeImage } from '@/components/ui/SafeImage';
import { BRAND } from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import type { Product } from '@/types/product';
import { savingsSuggestionStyles as cardStyles } from './savings-suggestion.styles';
import { startSavingsStyles as styles } from './start-savings.styles';
import type {
  SavingsProductChoice,
  StartSavingsColors,
} from './start-savings.types';
import type { StartSavingsProductController } from './start-savings-controller.types';
import {
  getSavingsVariantOptions,
  toProductChoice,
} from './start-savings-controller.utils';

type StartSavingsProductSuggestionsProps = {
  colors: StartSavingsColors;
  controller: StartSavingsProductController;
};

const MAX_PRODUCT_SUGGESTIONS = 5;

type SuggestionRow = {
  key: string;
  onPress: () => void;
  price: number | null;
  from: boolean;
  isPreview: boolean;
  product: SavingsProductChoice;
  title: string;
};

function getSuggestionRows(
  product: Product,
  selectProduct: StartSavingsProductController['selectProduct']
): SuggestionRow[] {
  const options = getSavingsVariantOptions(product);
  const prices = options
    .filter((option) => !option.unavailable)
    .map((option) => option.price);
  const choice = toProductChoice(product);
  return [
    {
      key: product.id,
      onPress: () => selectProduct(product),
      price: product.searchPreview
        ? null
        : options.length
          ? prices.length
            ? Math.min(...prices)
            : null
          : choice.price,
      from: options.length > 0,
      isPreview: !!product.searchPreview,
      product: choice,
      title: product.name,
    },
  ];
}

export function StartSavingsProductSuggestions({
  colors,
  controller,
}: StartSavingsProductSuggestionsProps) {
  if (controller.selectedProduct || !controller.debouncedSearch.trim()) {
    return null;
  }

  if (controller.isProductsLoading) {
    return (
      <View style={styles.productSuggestions}>
        <ActivityIndicator
          accessibilityLabel="Loading savings products"
          size="small"
          color={BRAND.primary}
        />
      </View>
    );
  }

  if (controller.products.length === 0) {
    return (
      <View style={styles.productSuggestions}>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          No matching products found.
        </Text>
      </View>
    );
  }

  const rows = controller.products
    .slice(0, MAX_PRODUCT_SUGGESTIONS)
    .flatMap((product) => getSuggestionRows(product, controller.selectProduct));

  return (
    <View style={cardStyles.results}>
      <Text style={[cardStyles.heading, { color: colors.textSecondary }]}>
        FIND YOUR NEXT UPGRADE
      </Text>
      {rows.map((row) => (
        <Pressable
          key={row.key}
          accessibilityRole="button"
          accessibilityLabel={`Select ${row.title}`}
          onPress={row.onPress}
          style={[
            cardStyles.card,
            {
              borderColor: colors.border,
              backgroundColor: colors.card,
            },
          ]}
        >
          <View style={cardStyles.imageFrame}>
            <SafeImage
              source={{ uri: row.product.image, width: 156, height: 192 }}
              style={cardStyles.image}
              contentFit="contain"
              accessibilityLabel={row.product.name}
            />
          </View>
          <View style={cardStyles.details}>
            <Text style={[cardStyles.name, { color: colors.text }]}>
              {row.product.name}
            </Text>
            <ProductMeta colors={colors} product={row.product} />
            <Text style={[cardStyles.price, { color: colors.text }]}>
              {row.price === null
                ? row.isPreview
                  ? ''
                  : 'Price unavailable'
                : `${row.from ? 'From ' : ''}${formatNgnCurrency(row.price)}`}
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textSecondary}
          />
        </Pressable>
      ))}
    </View>
  );
}

function ProductMeta({
  colors,
  product,
}: {
  colors: StartSavingsColors;
  product: SavingsProductChoice;
}) {
  const meta = [product.conditionLabel, product.variantLabel].filter(
    (value): value is string => Boolean(value)
  );
  if (meta.length === 0) {
    return null;
  }

  return (
    <Text style={[styles.productMetaText, { color: colors.textSecondary }]}>
      {meta.join(' · ')}
    </Text>
  );
}
