import { Info } from 'lucide-react';
import { ThemedBadge } from '@/components/themed';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { Product } from '@/lib/products';
import { cn } from '@/lib/utils';

/**
 * PDP stock status: availability badge, unit count, and minimum-order
 * notice. Split from ProductDetailClient (modularity rule).
 */
export function ProductDetailStockPanel({
  product,
  isOutOfStock,
  isStockManaged,
  currentStock,
}: {
  product: Product;
  isOutOfStock: boolean;
  isStockManaged: boolean;
  currentStock: number;
}) {
  return (
    <>
      <div>
        {isOutOfStock ? (
          <ThemedBadge colorRole="primary" variant="destructive">
            Out of Stock
          </ThemedBadge>
        ) : (
          <ThemedBadge colorRole="primary" variant="outline">
            {isStockManaged ? 'In Stock' : 'Unlimited stock'}
          </ThemedBadge>
        )}
        {isStockManaged ? (
          currentStock > 0 && Number.isFinite(currentStock) ? (
            <p
              className={cn(
                'text-sm mt-2',
                currentStock <= (product.low_stock_threshold || 5)
                  ? 'text-amber-600 font-medium'
                  : 'text-muted-foreground'
              )}
            >
              {currentStock} units available
              {currentStock <= (product.low_stock_threshold || 5) &&
                ' (Low Stock)'}
            </p>
          ) : null
        ) : (
          <p className="text-sm mt-2 text-muted-foreground">
            Unlimited stock available
          </p>
        )}
      </div>

      {product.minimum_order_quantity && product.minimum_order_quantity > 1 && (
        <Alert className="bg-blue-50 border-blue-200 text-blue-800">
          <Info className="size-4 text-blue-600" />
          <AlertDescription>
            Minimum order quantity:{' '}
            <strong>{product.minimum_order_quantity} units</strong>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
