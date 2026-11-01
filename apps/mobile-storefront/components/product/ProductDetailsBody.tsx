import { View } from 'react-native';
import Animated, {
  FadeInDown,
  useReducedMotion,
} from 'react-native-reanimated';
import type Colors from '@/constants/Colors';
import type { Review, ReviewStats } from '@/hooks/use-reviews';
import { isInternalSelectionAxis } from '@/lib/product-internal-selection-axes';
import { mergeVariantAttributes } from '@/lib/product-normalization';
import type { Product, ProductCondition } from '@/types/product';
import { productDetailsBodyStyles as styles } from './ProductDetailsBody.styles';
import { ProductDetailsContentSections } from './ProductDetailsContentSections';
import { ProductDetailsSummary } from './ProductDetailsSummary';
import { ProductDetailsVariantSection } from './ProductDetailsVariantSection';

type ColorsScheme = (typeof Colors)['light'];

export interface ProductDetailsBodyProps {
  availableConditions: ProductCondition[];
  conditionOffers: NonNullable<Product['offers']>;
  product: Product;
  effectivePrice: number;
  effectiveComparePrice: number | undefined;
  selectedVariant: string | null;
  setSelectedVariant: (id: string) => void;
  selectedCondition: ProductCondition | null;
  setSelectedCondition: (c: ProductCondition) => void;
  selectedAttributes: Record<string, string>;
  selectedColor: string | null;
  selectedStorage: string | null;
  onSelectAttribute: (axis: string, value: string) => void;
  onSelectColor: (color: string, imgs?: string[]) => void;
  onSelectStorage: (storage: string) => void;
  reviews: Review[];
  reviewStats: ReviewStats | null;
  reviewsLoading: boolean;
  hasMoreReviews: boolean;
  loadMoreReviews: () => Promise<void>;
  onMarkHelpful: (reviewId: string) => void;
  colors: ColorsScheme;
}

export function ProductDetailsBody({
  availableConditions,
  conditionOffers,
  product,
  effectivePrice,
  effectiveComparePrice,
  selectedVariant,
  setSelectedVariant,
  selectedCondition,
  setSelectedCondition,
  selectedAttributes,
  selectedColor,
  selectedStorage,
  onSelectAttribute,
  onSelectColor,
  onSelectStorage,
  reviews,
  reviewStats,
  reviewsLoading,
  hasMoreReviews,
  loadMoreReviews,
  onMarkHelpful,
  colors,
}: ProductDetailsBodyProps) {
  const reducedMotion = useReducedMotion();
  const mergedVariantAttributes = mergeVariantAttributes(
    product.variant_attributes,
    product.variants
  );
  const showVariantSelector =
    Boolean(product.colors) ||
    Boolean(product.color_images) ||
    Boolean(
      mergedVariantAttributes && Object.keys(mergedVariantAttributes).length > 0
    ) ||
    Boolean(mergedVariantAttributes?.storage) ||
    Boolean(
      product.variants?.some(
        (v) => v.attributes && Object.keys(v.attributes).length > 0
      )
    );
  const hasPriceDrivingVariantAxes =
    Boolean(mergedVariantAttributes?.storage) ||
    Boolean(mergedVariantAttributes?.color) ||
    Boolean(mergedVariantAttributes?.colour) ||
    Object.keys(mergedVariantAttributes ?? {}).some(
      (axis) => !isInternalSelectionAxis(axis)
    );

  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeInDown.delay(200).duration(600)}
      style={[styles.detailsContainer, { backgroundColor: colors.background }]}
    >
      <ProductDetailsSummary
        colors={colors}
        effectiveComparePrice={effectiveComparePrice}
        effectivePrice={effectivePrice}
        product={product}
        reviewStats={reviewStats}
      />

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <ProductDetailsVariantSection
        availableConditions={availableConditions}
        canShowVariantSelector={showVariantSelector}
        colors={colors}
        conditionOffers={conditionOffers}
        hasPriceDrivingVariantAxes={hasPriceDrivingVariantAxes}
        mergedVariantAttributes={mergedVariantAttributes}
        onSelectAttribute={onSelectAttribute}
        onSelectColor={onSelectColor}
        onSelectStorage={onSelectStorage}
        product={product}
        selectedAttributes={selectedAttributes}
        selectedColor={selectedColor}
        selectedCondition={selectedCondition}
        selectedStorage={selectedStorage}
        selectedVariant={selectedVariant}
        setSelectedCondition={setSelectedCondition}
        setSelectedVariant={setSelectedVariant}
      />

      <ProductDetailsContentSections
        colors={colors}
        hasMoreReviews={hasMoreReviews}
        loadMoreReviews={loadMoreReviews}
        onMarkHelpful={onMarkHelpful}
        product={product}
        reviews={reviews}
        reviewStats={reviewStats}
        reviewsLoading={reviewsLoading}
      />
    </Animated.View>
  );
}
