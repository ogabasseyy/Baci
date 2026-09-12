import type { CartItem } from '@/hooks/use-cart';
import type { Product } from '@/lib/products';
import { StorefrontProductCard } from './product-card';

// Static Tailwind class mappings to ensure classes are included in the build
const GRID_COLUMN_CLASSES: Record<number, string> = {
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
};

const STAGGER_CLASSES = [
  'stagger-1',
  'stagger-2',
  'stagger-3',
  'stagger-4',
  'stagger-5',
  'stagger-6',
  'stagger-7',
  'stagger-8',
];

export function ProductGridItems({
  products,
  columns,
  cartItemsMap,
  basePath,
  onAddToCart,
  onUpdateQuantity,
  onQuickView,
}: {
  products: Product[];
  columns: number;
  cartItemsMap: ReadonlyMap<string, CartItem>;
  basePath: string;
  onAddToCart: (product: Product) => void;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onQuickView: (product: Product) => void;
}) {
  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 ${GRID_COLUMN_CLASSES[columns] || GRID_COLUMN_CLASSES[4]} gap-6`}
    >
      {products.map((product, index) => (
        <StorefrontProductCard
          key={product.id}
          product={product}
          cartItem={cartItemsMap.get(product.id)}
          staggerClass={STAGGER_CLASSES[index % STAGGER_CLASSES.length]}
          onAddToCart={onAddToCart}
          onUpdateQuantity={onUpdateQuantity}
          onQuickView={onQuickView}
          basePath={basePath}
          priority={index < 4}
        />
      ))}
    </div>
  );
}
