import { View } from 'react-native';
import { ProductCard } from '@/components/storefront/ProductCard';
import type { CardVariant } from '@/lib/templates';
import type { HomeFeedListItem } from './HomeFeedList';
import { homeFeedStyles } from './home-feed.styles';

/**
 * One row of the home feed list: a product card in the current variant, or
 * the end sentinel that triggers pagination before footer blocks extend the
 * measured list end.
 */
export function HomeFeedListItemView({
  item,
  index,
  target,
  currentVariant,
  neutralPrice,
  onProductDataEndReached,
}: {
  item: HomeFeedListItem;
  index: number;
  target?: string;
  currentVariant: CardVariant;
  neutralPrice?: boolean;
  onProductDataEndReached: () => void;
}) {
  if (item.kind === 'product-list-end') {
    return (
      <View
        testID="home-feed-product-end-sentinel"
        style={homeFeedStyles.productEndSentinel}
        onLayout={target === 'Cell' ? onProductDataEndReached : undefined}
      />
    );
  }

  if (currentVariant === 'grid') {
    return (
      <View
        style={[
          homeFeedStyles.productWrapper,
          index % 2 === 0
            ? homeFeedStyles.productLeft
            : homeFeedStyles.productRight,
        ]}
      >
        <ProductCard
          neutralPrice={neutralPrice}
          product={item.product}
          variant="grid"
        />
      </View>
    );
  }

  return (
    <View style={homeFeedStyles.fullWidthCell}>
      <ProductCard
        neutralPrice={neutralPrice}
        product={item.product}
        variant={currentVariant}
      />
    </View>
  );
}
