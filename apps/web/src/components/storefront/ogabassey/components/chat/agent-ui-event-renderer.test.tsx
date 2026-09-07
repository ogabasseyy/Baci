import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorefrontAgentUiEvent } from '@/schemas/storefront-agent-ui-contract';
import { AgentUiEventRenderer } from './agent-ui-event-renderer';

const mocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  cart: [] as { id: string }[],
  setIsCartOpen: vi.fn(),
}));

vi.mock('@/hooks/cart', () => ({
  useCart: () => ({
    addToCart: mocks.addToCart,
    cart: mocks.cart,
    setIsCartOpen: mocks.setIsCartOpen,
  }),
}));

vi.mock('@/hooks/merchant', () => ({
  useMerchantSafe: () => ({ basePath: '/ogabassey' }),
}));

vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: ({ alt }: { alt: string }) => <span>{alt} image</span>,
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function event(
  overrides: Partial<StorefrontAgentUiEvent['products'][number]> = {}
): StorefrontAgentUiEvent {
  return {
    intent: 'discover',
    products: [
      {
        brand: 'Apple',
        category: 'Smartphones',
        description: 'Current catalog product',
        hasVariants: false,
        id: 'product-1',
        imageUrl: 'https://cdn.example.com/iphone.jpg',
        manageStock: true,
        name: 'iPhone 16',
        price: 1_200_000,
        slug: 'iphone-16',
        stock: 3,
        ...overrides,
      },
    ],
    title: 'Products I found',
    type: 'present_products',
  };
}

describe('AgentUiEventRenderer', () => {
  it.each([
    { hasConditionOffers: true },
    { variantModel: 'sku_matrix' },
    { availableConditions: ['New', 'Used'] },
    { condition: 'used' },
    { condition: 'open_box' },
    { minimumOrderQuantity: 3 },
  ])('requires PDP selection without variants for %j', (metadata) => {
    const base = event();
    render(
      <AgentUiEventRenderer
        events={[
          {
            ...base,
            products: base.products.map((product) => ({
              ...product,
              ...metadata,
            })),
          },
        ]}
      />
    );
    expect(
      screen.getByRole('link', { name: 'Choose options' })
    ).toHaveAttribute('href');
    expect(screen.queryByRole('button', { name: /Add.*cart/ })).toBeNull();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cart = [];
  });

  it('renders product cards and storefront-owned actions', () => {
    render(<AgentUiEventRenderer events={[event()]} />);

    expect(screen.getByRole('article', { name: 'iPhone 16' })).toBeDefined();
    expect(screen.getByText(/1,200,000/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'View product' })).toHaveAttribute(
      'href',
      '/ogabassey/smartphones/iphone-16'
    );
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled();
  });

  it('adds a validated catalog product through the existing cart context', async () => {
    const user = userEvent.setup();
    render(<AgentUiEventRenderer events={[event()]} />);

    await user.click(screen.getByRole('button', { name: 'Add to cart' }));

    expect(mocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'product-1',
        name: 'iPhone 16',
        price: 1_200_000,
        slug: 'iphone-16',
      }),
      1
    );
    expect(mocks.setIsCartOpen).toHaveBeenCalledWith(true);
  });

  it('adds the bounded quantity requested through the commerce tool', async () => {
    const user = userEvent.setup();
    render(<AgentUiEventRenderer events={[event({ quantity: 2 })]} />);

    await user.click(screen.getByRole('button', { name: 'Add 2 to cart' }));

    expect(mocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'product-1' }),
      2
    );
  });

  it('routes variant products to option selection instead of bypassing it', () => {
    render(<AgentUiEventRenderer events={[event({ hasVariants: true })]} />);

    expect(
      screen.getByRole('link', { name: 'Choose options' })
    ).toHaveAttribute('href', '/ogabassey/smartphones/iphone-16');
    expect(screen.queryByRole('button', { name: 'Add to cart' })).toBeNull();
  });

  it('caps a request for five units at managed stock of two', async () => {
    render(
      <AgentUiEventRenderer events={[event({ quantity: 5, stock: 2 })]} />
    );
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Add 2 to cart' }));
    expect(mocks.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'product-1' }),
      2
    );
  });

  it('allows re-adding after the live cart removes the product', async () => {
    mocks.cart = [{ id: 'product-1' }];
    const { rerender } = render(<AgentUiEventRenderer events={[event()]} />);
    expect(screen.getByRole('button', { name: 'Added' })).toBeDisabled();
    mocks.cart = [];
    rerender(<AgentUiEventRenderer events={[event()]} />);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Add to cart' }));
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
  });

  it('does not enable add-to-cart for managed products without stock', () => {
    render(<AgentUiEventRenderer events={[event({ stock: 0 })]} />);

    expect(screen.getByRole('button', { name: 'Out of stock' })).toBeDisabled();
  });

  it('drops events that do not match the allowlisted registry', () => {
    const untrustedEvent = {
      ...event(),
      action: { type: 'complete_purchase' },
    } as unknown as StorefrontAgentUiEvent;

    const { container } = render(
      <AgentUiEventRenderer events={[untrustedEvent]} />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
