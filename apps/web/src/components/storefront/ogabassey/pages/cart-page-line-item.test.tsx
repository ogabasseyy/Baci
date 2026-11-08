import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/hooks/cart';
import { CartPageLineItem } from './cart-page-line-item';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/image', () => ({
  default: ({
    alt,
    fill: _fill,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => (
    <img alt={alt} {...props} />
  ),
}));

// Line-item images now render through CdnFormatImage (explicit per-format
// <picture>); surface it as a plain <img> so these tests keep asserting cart
// line-item behavior.
vi.mock('@/components/storefront/cdn-format-image', () => ({
  CdnFormatImage: ({
    alt,
    fill: _fill,
    preload: _preload,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    preload?: boolean;
  }) => <img alt={alt} {...props} />,
}));

const cartItem = {
  id: 'p1',
  cartItemId: 'ci-1',
  name: 'Test Gadget',
  description: 'A test gadget.',
  status: 'active',
  price: 25000,
  manage_stock: true,
  stock: 8,
  quantity: 2,
  image: '/gadget.jpg',
  imageLarge: '/gadget-large.jpg',
  imageHint: 'gadget product photo',
  category: 'electronics',
  brand: 'Brand',
  gtin: '',
  mpn: '',
  condition: 'new',
  hasAssurance: true,
} satisfies CartItem;

function renderLineItem(
  overrides: Partial<CartItem> = {},
  propOverrides: Partial<
    Pick<
      React.ComponentProps<typeof CartPageLineItem>,
      'shippingInsuranceEnabled' | 'hasPriceNegotiation'
    >
  > = {}
) {
  const props = {
    hasPriceNegotiation: true,
    item: { ...cartItem, ...overrides },
    merchantSlug: 'ogabassey',
    onOpenItemNegotiation: vi.fn(),
    onRemove: vi.fn(),
    onToggleAssurance: vi.fn(),
    onUpdateQuantity: vi.fn(),
    productHref: '/test-store/electronics/test-gadget',
    shippingInsuranceEnabled: true,
    ...propOverrides,
  };

  render(<CartPageLineItem {...props} />);

  return props;
}

describe('CartPageLineItem', () => {
  it('keeps the product image inside the neutral image surface', () => {
    renderLineItem();

    expect(
      screen
        .getByAltText('Test Gadget')
        .closest('.ogabassey-product-card-image-surface')
    ).toBeInTheDocument();
  });

  it('wires quantity and assurance controls to the cart callbacks', () => {
    const props = renderLineItem();

    fireEvent.click(screen.getByRole('button', { name: /decrease quantity/i }));
    fireEvent.click(screen.getByRole('button', { name: /increase quantity/i }));
    fireEvent.click(screen.getByRole('checkbox'));

    expect(props.onUpdateQuantity).toHaveBeenCalledWith('ci-1', 1);
    expect(props.onUpdateQuantity).toHaveBeenCalledWith('ci-1', 3);
    expect(props.onToggleAssurance).toHaveBeenCalledWith('ci-1');
  });

  it('normalizes invalid persisted quantities before rendering controls', () => {
    const props = renderLineItem({ quantity: Number.NaN });

    const decreaseButton = screen.getByRole('button', {
      name: /decrease quantity/i,
    });

    expect(decreaseButton).toBeDisabled();
    expect(screen.getByText('0')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /increase quantity/i }));

    expect(props.onUpdateQuantity).toHaveBeenCalledWith('ci-1', 1);
  });

  it('keeps the removal control for an assured line when insurance is off', () => {
    const props = renderLineItem(
      { hasAssurance: true },
      { shippingInsuranceEnabled: false }
    );

    fireEvent.click(screen.getByRole('checkbox'));
    expect(props.onToggleAssurance).toHaveBeenCalledWith('ci-1');
  });

  it('hides assurance for an unassured line when insurance is off', () => {
    renderLineItem(
      { hasAssurance: false },
      { shippingInsuranceEnabled: false }
    );

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

it('shows the exact saved variant on the full cart page', () => {
  renderLineItem({
    variantAttributes: {
      storage: '512GB',
      sim_type: 'Physical + eSIM',
      color: 'Silver',
    },
  });
  for (const value of ['512GB', 'Physical + eSIM', 'Silver'])
    expect(screen.getByText(value)).toBeVisible();
  expect(screen.getByText('Storage:')).toHaveClass('sr-only');
});

it('omits the empty extras area when protection and negotiation are unavailable', () => {
  renderLineItem(
    { hasAssurance: false },
    { shippingInsuranceEnabled: false, hasPriceNegotiation: false }
  );
  expect(
    screen.queryByRole('group', { name: 'Product extras' })
  ).not.toBeInTheDocument();
});
