'use client';

import { Check, ImageIcon } from 'lucide-react';
import { ThumbnailImage } from '@/components/optimized-image';
import { formatCurrency } from '@/lib/currency';
import { PRODUCT_IMAGE_PLACEHOLDER_URL } from '@/lib/product-image';
import { cn } from '@/lib/utils';
import type { QuizPrizeProduct } from '@/schemas/quiz-prize-product';

interface QuizPrizeProductResultProps {
  highlighted: boolean;
  id: string;
  onSelect: (product: QuizPrizeProduct) => void;
  product: QuizPrizeProduct;
  selected: boolean;
}

function availabilityLabel(product: QuizPrizeProduct) {
  if (product.requiresVariantSelection) return 'Choose a specific variant';
  if (!product.available) return 'Out of stock';
  if (!product.manageStock) return 'Stock not tracked';
  return `${product.effectiveStock ?? 0} available`;
}

export function QuizPrizeProductResult({
  highlighted,
  id,
  onSelect,
  product,
  selected,
}: QuizPrizeProductResultProps) {
  const disabled = !product.available || product.requiresVariantSelection;
  const detail = [product.variantLabel, product.condition]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      aria-disabled={disabled}
      aria-selected={selected}
      className={cn(
        'grid w-full grid-cols-[3.25rem_1fr_auto] items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors',
        highlighted && 'border-border bg-accent',
        selected && 'bg-primary/10',
        disabled && 'cursor-not-allowed opacity-55'
      )}
      id={id}
      onClick={() => {
        if (!disabled) onSelect(product);
      }}
      onMouseDown={(event) => event.preventDefault()}
      role="option"
      tabIndex={-1}
      type="button"
    >
      <span className="relative flex size-13 items-center justify-center overflow-hidden rounded-md border bg-muted">
        {product.imageUrl ? (
          <ThumbnailImage
            alt={`${product.name}${product.variantLabel ? ` ${product.variantLabel}` : ''}`}
            className="object-cover"
            fill
            fallbackSrc={PRODUCT_IMAGE_PLACEHOLDER_URL}
            sizes="52px"
            src={product.imageUrl}
            unoptimized
          />
        ) : (
          <ImageIcon
            aria-hidden="true"
            className="size-5 text-muted-foreground"
          />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-foreground">
          {product.name}
        </span>
        <span className="block truncate text-xs capitalize text-muted-foreground">
          {detail || 'Standard product'}
        </span>
        <span
          className={cn(
            'block text-xs',
            product.available && !product.requiresVariantSelection
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-destructive'
          )}
        >
          {availabilityLabel(product)}
        </span>
      </span>
      <span className="flex items-center gap-2 pl-2">
        <span className="whitespace-nowrap text-sm font-semibold">
          {formatCurrency(product.price, 'NG', {
            maximumFractionDigits: 0,
            minimumFractionDigits: 0,
          })}
        </span>
        <Check
          aria-hidden="true"
          className={cn(
            'size-4 text-primary',
            selected ? 'opacity-100' : 'opacity-0'
          )}
        />
      </span>
    </button>
  );
}
