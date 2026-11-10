import '@testing-library/jest-dom/vitest';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const c = vi.hoisted(() => ({ add: vi.fn(), products: vi.fn() }));
vi.mock('@/hooks/cart/cart-context', () => ({
  useCartSafe: () => ({
    experienceCommandPort: {},
    cartTotal: 0,
    addToCart: c.add,
  }),
}));
vi.mock('@/hooks/cart/shared-cart-products', () => ({
  fetchSharedCartProducts: c.products,
}));

import { ExperienceEngineFallback } from './ExperienceEngineFallback';

beforeEach(() => {
  c.add.mockReset();
  c.products.mockReset();
});

it.each([
  'applied',
  'rejected',
] as const)('uses the native cart outcome %s for an available variant', async (outcome) => {
  c.add.mockReturnValue(outcome);
  const p = {
    id: 'p',
    name: 'Synthetic device',
    price: 250,
    currency: 'NGN',
    slug: 'device',
    canonicalPath: '/phones/device',
    available: true,
    image: null,
    requiresVariant: true,
    variants: [{ id: 'v', label: 'Blue', available: true }],
  };
  c.products.mockResolvedValue(
    new Map([['p', { id: 'p', name: 'Current engine product', price: 275 }]])
  );
  render(
    <ExperienceEngineFallback
      bootstrap={
        {
          catalog: { revision: 'r', products: [p] },
          capabilities: ['cart.mutate'],
          route: {},
        } as never
      }
      title="Current store"
      merchantId="m"
      canonicalBase="http://localhost/qa1"
    />
  );
  expect(
    screen.getByRole('button', { name: 'Add Synthetic device' })
  ).toBeDisabled();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'v' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add Synthetic device' }));
  await waitFor(() =>
    expect(c.add).toHaveBeenCalledWith(
      expect.objectContaining({ price: 275 }),
      1,
      { variantId: 'v' }
    )
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    outcome === 'applied'
      ? 'Added using Baci cart.'
      : 'Unable to add using Baci cart.'
  );
  expect(
    screen.getByRole('link', { name: 'Synthetic device' })
  ).toHaveAttribute('href', '/qa1/phones/device');
});

it('reports a safe status and does not add to cart when current product lookup rejects', async () => {
  c.products.mockRejectedValue(new Error('catalog unavailable'));
  render(
    <ExperienceEngineFallback
      bootstrap={
        {
          catalog: {
            revision: 'r',
            products: [
              {
                id: 'p',
                name: 'Synthetic device',
                price: 250,
                currency: 'NGN',
                slug: 'device',
                available: true,
                image: null,
                requiresVariant: false,
                variants: [],
              },
            ],
          },
          capabilities: ['cart.mutate'],
          route: {},
        } as never
      }
      title="Current store"
      merchantId="m"
      canonicalBase="http://localhost/qa1"
    />
  );

  fireEvent.click(screen.getByRole('button', { name: 'Add Synthetic device' }));

  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Could not load this product. Refresh the storefront and try again.'
    )
  );
  expect(c.add).not.toHaveBeenCalled();
});

it('reports an unavailable product without adding to cart when the current lookup is empty', async () => {
  c.products.mockResolvedValue(new Map());
  render(
    <ExperienceEngineFallback
      bootstrap={
        {
          catalog: {
            revision: 'r',
            products: [
              {
                id: 'p',
                name: 'Synthetic device',
                price: 250,
                currency: 'NGN',
                slug: 'device',
                available: true,
                image: null,
                requiresVariant: false,
                variants: [],
              },
            ],
          },
          capabilities: ['cart.mutate'],
          route: {},
        } as never
      }
      title="Current store"
      merchantId="m"
      canonicalBase="http://localhost/qa1"
    />
  );

  fireEvent.click(screen.getByRole('button', { name: 'Add Synthetic device' }));

  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Product unavailable. Refresh the storefront.'
    )
  );
  expect(c.add).not.toHaveBeenCalled();
});
