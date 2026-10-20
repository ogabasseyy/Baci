import Image from 'next/image';
import type { Product } from '@/lib/products';
import { cn } from '@/lib/utils';
import { PLACEHOLDER_IMAGE } from './product-selection-placeholder';

/**
 * PDP image gallery: hero image plus thumbnail strip. Split from
 * ProductDetailClient (modularity rule).
 */
export function ProductDetailGallery({
  product,
  selectedImage,
  onSelectImage,
}: {
  product: Product;
  selectedImage: string | null | undefined;
  onSelectImage: (url: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-muted/50 rounded-lg overflow-hidden aspect-square relative border border-border/50">
        <Image
          src={selectedImage || PLACEHOLDER_IMAGE}
          alt={product.name}
          data-ai-hint={product.imageHint}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          priority
          className="object-cover"
        />
      </div>
      {product.images && product.images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          <button
            type="button"
            onClick={() => onSelectImage(product.imageLarge || product.image)}
            className={cn(
              'relative w-20 h-20 rounded-md overflow-hidden border-2 shrink-0',
              selectedImage === (product.imageLarge || product.image)
                ? 'border-primary'
                : 'border-transparent'
            )}
          >
            <Image
              src={product.imageLarge || product.image || PLACEHOLDER_IMAGE}
              alt={`${product.name} - Main image`}
              fill
              sizes="80px"
              className="object-cover"
            />
          </button>
          {product.images
            .filter((img) => img.url)
            .map((img, idx) => (
              <button
                key={img.url || `img-${idx}`}
                type="button"
                onClick={() => onSelectImage(img.url)}
                className={cn(
                  'relative w-20 h-20 rounded-md overflow-hidden border-2 shrink-0',
                  selectedImage === img.url
                    ? 'border-primary'
                    : 'border-transparent'
                )}
              >
                <Image
                  src={img.url}
                  alt={img.alt || `Product image ${idx + 1}`}
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
