import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../types';

const mockUseMerchantSafe = vi.hoisted(() => vi.fn());

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: (props: Record<string, unknown>) => {
    const { fill: _fill, preload: _preload, ...rest } = props;
    // biome-ignore lint/performance/noImgElement: test double
    return <img {...rest} alt={String(props.alt ?? '')} />;
  },
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: mockUseMerchantSafe,
}));

import { ProductComparisonTable } from './ProductComparisonTable';

function createMainProduct(): Product {
  return {
    id: 'main-product',
    merchantId: 'merchant-1',
    name: 'Main Phone',
    slug: 'main-phone',
    price: '₦100,000',
    rawPrice: 100000,
    image: 'https://example.com/main.jpg',
    images: ['https://example.com/main.jpg'],
    description: 'Main product',
    category: 'Smartphones',
    categorySlug: 'smartphones',
    condition: 'new',
  };
}

describe('ProductComparisonTable API category slug', () => {
  beforeEach(() => {
    mockUseMerchantSafe.mockReturnValue({
      basePath: '/ogabassey',
      merchant: { country: 'NG', payout_currency: 'NGN' },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses category_slug for both the comparison link and spec family when joined category data is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          products: [
            {
              id: 'action-camera',
              name: 'Action Camera',
              slug: 'action-camera',
              price: 500000,
              image: 'https://example.com/camera.jpg',
              category: 'Smartphones',
              category_slug: 'action-cameras',
              condition: 'new',
              product_key_specs: { main_camera_mp: 40, has_5g: true },
            },
          ],
        }),
      }))
    );

    render(
      <ProductComparisonTable
        mainProduct={createMainProduct()}
        storeSlug="ogabassey"
      />
    );

    fireEvent.click(
      screen.getAllByRole('button', { name: /compare similar smartphones/i })[0]
    );
    fireEvent.change(screen.getByRole('textbox', { name: /search products/i }), {
      target: { value: 'action camera' },
    });
    fireEvent.click(await screen.findByText('Action Camera'));

    expect(screen.getByRole('link', { name: 'Action Camera' })).toHaveAttribute(
      'href',
      '/ogabassey/action-cameras/action-camera'
    );
    expect(await screen.findByText('Effective Resolution')).toBeInTheDocument();
    expect(screen.getAllByText('40MP')).not.toHaveLength(0);
    expect(screen.queryByText('5G Support')).not.toBeInTheDocument();
  });

  it('uses a slug-only camera join instead of stale phone text for comparison specs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          products: [
            {
              id: 'action-camera',
              name: 'Action Camera',
              slug: 'action-camera',
              price: 500,
              image: 'https://example.com/camera.jpg',
              category: 'Smartphones',
              categories: {
                id: 'camera-category',
                name: '',
                slug: 'action-cameras',
              },
              condition: 'new',
              product_key_specs: { main_camera_mp: 40, has_5g: true },
            },
          ],
        }),
      }))
    );

    render(
      <ProductComparisonTable
        mainProduct={createMainProduct()}
        storeSlug="ogabassey"
      />
    );

    fireEvent.click(
      screen.getAllByRole('button', { name: /compare similar smartphones/i })[0]
    );
    fireEvent.change(screen.getByRole('textbox', { name: /search products/i }), {
      target: { value: 'action camera' },
    });
    fireEvent.click(await screen.findByText('Action Camera'));

    expect(await screen.findByText('Effective Resolution')).toBeInTheDocument();
    expect(screen.getAllByText('40MP')).not.toHaveLength(0);
    expect(screen.queryByText('5G Support')).not.toBeInTheDocument();
  });
  it('ignores a whitespace-only joined slug before using category_slug for links', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          products: [
            {
              id: 'action-camera',
              name: 'Action Camera',
              slug: 'action-camera',
              price: 500000,
              image: 'https://example.com/camera.jpg',
              category: 'Cameras',
              category_slug: 'action-cameras',
              categories: { id: 'camera-category', name: 'Cameras', slug: '   ' },
              condition: 'new',
            },
          ],
        }),
      }))
    );

    render(
      <ProductComparisonTable
        mainProduct={createMainProduct()}
        storeSlug="ogabassey"
      />
    );

    fireEvent.click(
      screen.getAllByRole('button', { name: /compare similar smartphones/i })[0]
    );
    fireEvent.change(screen.getByRole('textbox', { name: /search products/i }), {
      target: { value: 'action camera' },
    });
    fireEvent.click(await screen.findByText('Action Camera'));

    expect(screen.getByRole('link', { name: 'Action Camera' })).toHaveAttribute(
      'href',
      '/ogabassey/action-cameras/action-camera'
    );
  });

});
