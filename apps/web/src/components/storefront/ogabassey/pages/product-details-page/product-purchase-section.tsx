import type { ComponentProps } from 'react';
import { ProductInteractionPanel } from './product-interaction-panel';
import { ProductPurchasePanel } from './product-purchase-panel';

type ProductDetailsPurchaseSectionProps = ComponentProps<
  typeof ProductPurchasePanel
> & {
  /**
   * Commerce embeds render the interaction panel; full pages render the
   * purchase panel. Both panels take identical props.
   */
  isCommerceMode: boolean;
};

export function ProductDetailsPurchaseSection(
  props: ProductDetailsPurchaseSectionProps
) {
  const { isCommerceMode, ...panelProps } = props;
  if (isCommerceMode) {
    return <ProductInteractionPanel {...panelProps} />;
  }
  return <ProductPurchasePanel {...panelProps} />;
}
