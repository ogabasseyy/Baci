function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(' ');
}

/**
 * Base Skeleton component with shimmer animation
 * All skeleton loaders use this as foundation
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-muted relative overflow-hidden',
        // Shimmer effect overlay
        'after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_2s_infinite]',
        'after:bg-linear-to-r after:from-transparent after:via-white/10 after:to-transparent',
        className
      )}
      {...props}
    />
  );
}

/**
 * Product Card Skeleton - matches ProductCard layout
 * Used in product grids across all merchant storefronts
 */
/**
 * Product Card Skeleton - matches ProductCard layout
 * Used in product grids across all merchant storefronts
 * Uses explicit light colors + Shimmer
 */
export function ProductCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col space-y-3 relative overflow-hidden',
        className
      )}
      aria-hidden="true"
    >
      {/* Shimmer Overlay */}
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-linear-to-r from-transparent via-white/40 to-transparent z-10" />

      {/* Image placeholder */}
      <div className="aspect-square w-full rounded-lg bg-gray-200" />
      {/* Title */}
      <div className="h-4 w-3/4 bg-gray-200 rounded" />
      {/* Price */}
      <div className="h-4 w-1/4 bg-gray-200 rounded" />
      {/* Rating/badge area */}
      <div className="flex gap-2">
        <div className="h-3 w-16 bg-gray-200 rounded" />
        <div className="h-3 w-12 bg-gray-200 rounded" />
      </div>
      <span className="sr-only">Loading product details…</span>
    </div>
  );
}

/**
 * Product Grid Skeleton - renders multiple product card skeletons
 * Automatically matches grid layout of actual products
 */
export function ProductGridSkeleton({
  count = 8,
  columns = 4,
  className,
}: {
  count?: number;
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}) {
  const gridCols = {
    2: 'grid-cols-2',
    3: 'grid-cols-2 md:grid-cols-3',
    4: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
    5: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-5',
    6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6',
  };

  return (
    <div className={cn('grid gap-4 md:gap-6', gridCols[columns], className)}>
      {Array.from({ length: count }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Table Row Skeleton - for product catalogs, orders, etc.
 */
export function TableRowSkeleton({ columns = 5 }: { columns?: number }) {
  return (
    <tr className="border-b">
      {Array.from({ length: columns }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton
        <td key={i} className="p-4">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
}

/**
 * Table Skeleton - full table with header and rows
 */
export function TableSkeleton({
  rows = 5,
  columns = 5,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn('w-full', className)}>
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/50">
            {Array.from({ length: columns }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton
              <th key={i} className="p-4 text-left">
                <Skeleton className="h-4 w-20" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton
            <TableRowSkeleton key={i} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Stats Card Skeleton - for dashboard analytics cards
 */
export function StatsCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('p-6 rounded-lg border bg-card', className)}>
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="size-8 rounded-full" />
      </div>
      <Skeleton className="h-8 w-32 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

/**
 * Stats Grid Skeleton - multiple stats cards
 */
export function StatsGridSkeleton({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-4 md:grid-cols-2 lg:grid-cols-4', className)}>
      {Array.from({ length: count }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton
        <StatsCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Product Detail Skeleton - for single product pages
 * Uses explicit light colors to avoid dark theme bleed during SSR
 */
export function ProductDetailSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'grid md:grid-cols-2 gap-8 p-4 md:p-8 bg-white relative overflow-hidden',
        className
      )}
      aria-hidden="true"
    >
      {/* Shimmer Overlay */}
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-linear-to-r from-transparent via-white/50 to-transparent z-10" />

      {/* Image gallery */}
      <div className="space-y-4">
        <div className="aspect-square w-full rounded-lg bg-gray-200" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton
            <div key={i} className="size-20 rounded-md bg-gray-200" />
          ))}
        </div>
      </div>
      {/* Product info */}
      <div className="space-y-6">
        <div>
          <div className="h-8 w-3/4 mb-2 bg-gray-200 rounded" />
          <div className="h-6 w-1/4 bg-gray-200 rounded" />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-full bg-gray-200 rounded" />
          <div className="h-4 w-full bg-gray-200 rounded" />
          <div className="h-4 w-2/3 bg-gray-200 rounded" />
        </div>
        <div className="flex gap-4">
          <div className="h-12 w-32 bg-gray-200 rounded" />
          <div className="h-12 flex-1 bg-gray-200 rounded" />
        </div>
      </div>
      <span className="sr-only">Loading product information…</span>
    </div>
  );
}

/**
 * Cart Item Skeleton
 */
export function CartItemSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex gap-4 p-4 border-b', className)}>
      <Skeleton className="size-20 rounded-md shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/4" />
        <div className="flex justify-between items-center mt-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
    </div>
  );
}

/**
 * Cart Skeleton - full cart with multiple items
 */
export function CartSkeleton({
  items = 3,
  className,
}: {
  items?: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-0', className)}>
      {Array.from({ length: items }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton
        <CartItemSkeleton key={i} />
      ))}
      <div className="p-4 space-y-3">
        <div className="flex justify-between">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}

/**
 * Checkout Form Skeleton
 */
export function CheckoutFormSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-6', className)}>
      {/* Contact section */}
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
      {/* Address section */}
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
      {/* Payment section */}
      <div className="space-y-4">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

/**
 * Order Summary Skeleton
 */
export function OrderSummarySkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('p-6 rounded-lg border bg-card space-y-4', className)}>
      <Skeleton className="h-6 w-32" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton
          <div key={i} className="flex justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
      <div className="border-t pt-4">
        <div className="flex justify-between">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-24" />
        </div>
      </div>
    </div>
  );
}

/**
 * Storefront Header Skeleton - for merchant store headers
 * Uses explicit light colors to avoid dark theme bleed during SSR
 */
export function StorefrontHeaderSkeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <header
      className={cn(
        'border-b border-gray-200 bg-white relative overflow-hidden',
        className
      )}
      aria-busy="true"
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-linear-to-r from-transparent via-white/50 to-transparent z-10" />

      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="h-10 w-32 bg-gray-200 rounded" />
          <div className="hidden md:flex gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton
              <div key={i} className="h-4 w-16 bg-gray-200 rounded" />
            ))}
          </div>
          <div className="flex gap-4">
            <div className="size-10 rounded-full bg-gray-200" />
            <div className="size-10 rounded-full bg-gray-200" />
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * Storefront Hero Skeleton
 * Uses explicit light colors + Shimmer
 */
export function StorefrontHeroSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative h-[400px] md:h-[500px] bg-gray-100 overflow-hidden',
        className
      )}
      aria-hidden="true"
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-linear-to-r from-transparent via-white/30 to-transparent z-10" />

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center space-y-4 px-4">
          <div className="h-12 w-64 mx-auto bg-gray-200 rounded" />
          <div className="h-6 w-96 mx-auto bg-gray-200 rounded" />
          <div className="h-12 w-40 mx-auto bg-gray-200 rounded" />
        </div>
      </div>
    </div>
  );
}

/**
 * Full Storefront Page Skeleton - complete page skeleton for merchant stores
 * This is what users see while a merchant's storefront loads
 * Uses explicit light background + Shimmer
 */
export function StorefrontPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('min-h-screen bg-background', className)}
      aria-hidden="true"
    >
      <StorefrontHeaderSkeleton />
      <StorefrontHeroSkeleton />
    </div>
  );
}

/**
 * Dashboard Page Skeleton
 */
export function DashboardPageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-6', className)}>
      <div className="flex justify-between items-center">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-32" />
      </div>
      <StatsGridSkeleton count={4} />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="p-6 rounded-lg border bg-card">
          <Skeleton className="h-6 w-32 mb-4" />
          <Skeleton className="h-[200px] w-full" />
        </div>
        <div className="p-6 rounded-lg border bg-card">
          <Skeleton className="h-6 w-32 mb-4" />
          <Skeleton className="h-[200px] w-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * Products Page Skeleton (Dashboard)
 */
export function ProductsPageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-6', className)}>
      <div className="flex justify-between items-center">
        <Skeleton className="h-8 w-32" />
        <div className="flex gap-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
      <TableSkeleton rows={8} columns={6} />
      <div className="flex justify-between items-center">
        <Skeleton className="h-4 w-48" />
        <div className="flex gap-2">
          <Skeleton className="size-10" />
          <Skeleton className="size-10" />
          <Skeleton className="size-10" />
        </div>
      </div>
    </div>
  );
}

/**
 * Orders Page Skeleton (Dashboard)
 */
export function OrdersPageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-6', className)}>
      <div className="flex justify-between items-center">
        <Skeleton className="h-8 w-32" />
        <div className="flex gap-4">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
      <div className="flex gap-2 mb-4">
        {Array.from({ length: 5 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Skeleton
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <TableSkeleton rows={10} columns={7} />
    </div>
  );
}

// Re-export base Skeleton
export { Skeleton };
