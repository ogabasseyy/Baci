import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QuizPrizeProductResult } from './quiz-prize-product-result';

vi.mock('@/components/optimized-image', () => ({
  ThumbnailImage: ({
    alt,
    fallbackSrc,
    src,
    unoptimized,
  }: {
    alt: string;
    fallbackSrc?: string;
    src: string;
    unoptimized?: boolean;
  }) => (
    // biome-ignore lint/performance/noImgElement: deterministic image stub
    <img
      alt={alt}
      data-fallback-src={fallbackSrc}
      data-unoptimized={unoptimized ? 'true' : undefined}
      src={src}
    />
  ),
}));

const product = {
  available: true,
  condition: 'open_box',
  defaultVariantId: null,
  effectiveStock: 3,
  hasVariants: true,
  id: '55555555-5555-4555-8555-555555555555',
  imageUrl: 'https://cdn.example.com/galaxy.png',
  manageStock: true,
  name: 'Samsung Galaxy S25',
  price: 1_800_000,
  requiresVariantSelection: false,
  selectionId:
    '55555555-5555-4555-8555-555555555555:66666666-6666-4666-8666-666666666666',
  variantId: '66666666-6666-4666-8666-666666666666',
  variantLabel: '256GB / Blue',
};

describe('QuizPrizeProductResult', () => {
  it('shows the exact variant, condition, price, image, and availability', () => {
    render(
      <QuizPrizeProductResult
        highlighted={false}
        id="result-1"
        onSelect={vi.fn()}
        product={product}
        selected={false}
      />
    );

    expect(screen.getByText('Samsung Galaxy S25')).toBeInTheDocument();
    expect(screen.getByText('256GB / Blue · open_box')).toBeInTheDocument();
    expect(screen.getByText('3 available')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      'https://cdn.example.com/galaxy.png'
    );
    expect(screen.getByRole('img')).toHaveAttribute(
      'data-fallback-src',
      '/placeholder.png'
    );
    expect(screen.getByRole('img')).toHaveAttribute('data-unoptimized', 'true');
  });

  it('selects available exact variants but blocks parent placeholders', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <QuizPrizeProductResult
        highlighted
        id="result-1"
        onSelect={onSelect}
        product={product}
        selected={false}
      />
    );

    await user.click(screen.getByRole('option'));
    expect(onSelect).toHaveBeenCalledWith(product);

    rerender(
      <QuizPrizeProductResult
        highlighted={false}
        id="result-2"
        onSelect={onSelect}
        product={{
          ...product,
          available: false,
          requiresVariantSelection: true,
          variantId: null,
          variantLabel: null,
        }}
        selected={false}
      />
    );
    await user.click(screen.getByRole('option'));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.getByText('Choose a specific variant')).toBeInTheDocument();
  });
});
