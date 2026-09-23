import type { Product as CartProduct } from '@/lib/products';
import type { Dispatch, MouseEvent, SetStateAction } from 'react';
import type { Product } from '../types';
import { toRelatedProductsProduct } from './product-details-page/related-product';

/**
 * Added-to-cart feedback handler: adds the product, then clears the "Added"
 * state after a beat so repeat taps stay honest.
 */
export function createCategoryAddToCartHandler(
  addToCart: (product: CartProduct, quantity?: number) => void,
  setAddedItems: Dispatch<SetStateAction<string[]>>
): (_event: MouseEvent, product: Product) => void {
  return (_event, product) => {
    addToCart(toRelatedProductsProduct(product), 1);

    const productId = String(product.id);
    setAddedItems((prev) => [...prev, productId]);
    setTimeout(() => {
      setAddedItems((prev) => prev.filter((id) => id !== productId));
    }, 2000);
  };
}
