import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { Product } from '@/lib/products';
import { getStorefrontProductHref } from '@/lib/storefront-product-href';

export function QuickViewDetailsLink({
  product,
  basePath,
  onClose,
}: {
  product: Product;
  basePath: string;
  onClose: () => void;
}) {
  return (
    <Link
      href={getStorefrontProductHref(product, basePath)}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      onClick={onClose}
    >
      View Full Details
      <ExternalLink className="size-4" />
    </Link>
  );
}
