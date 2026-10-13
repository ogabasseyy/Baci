import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import Colors from '@/constants/Colors';
import type { CartItem } from '@/stores/cart-store';
import CartItemCard from './CartItemCard';

const mockPush = jest.fn();
const mockSafeImage = jest.fn((_props: unknown) => null);

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
  },
}));

jest.mock('@/components/ui/SafeImage', () => ({
  SafeImage: (props: unknown) => mockSafeImage(props),
}));

function createItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'cart-1',
    product_id: 'product-1',
    slug: 'iphone-13-pro-128gb',
    name: 'iPhone 13 Pro',
    price: 1000,
    quantity: 2,
    image_url: 'https://cdn.example.com/iphone-13-pro.jpg',
    condition: 'NEW',
    hasAssurance: false,
    assuranceRate: 0.05,
    ...overrides,
  };
}

const formatPrice = (amount: number) =>
  `₦${new Intl.NumberFormat('en-NG').format(amount)}`;

function renderCard(
  item: CartItem,
  overrides: Partial<ComponentProps<typeof CartItemCard>> = {}
) {
  const defaultProps: ComponentProps<typeof CartItemCard> = {
    item,
    handleQuantityChange: jest.fn(),
    handleRemoveItem: jest.fn(),
    toggleAssurance: jest.fn(),
    openItemNegotiation: jest.fn(),
    updateQuantity: jest.fn(),
    formatPrice,
    colors: Colors.light,
    surfaceInset: '#F8FAFC',
    disabledIconColor: '#94A3B8',
    negotiateSurface: '#FFFFFF',
    negotiateBorder: '#FECACA',
  };

  return render(<CartItemCard {...defaultProps} {...overrides} />);
}

describe('CartItemCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('bounds managed catalog images before passing them to SafeImage', () => {
    renderCard(
      createItem({
        image_url: 'https://cdn.ogabassey.com/core-assets/products/phone.avif',
      })
    );

    expect(mockSafeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: {
          height: 128,
          uri: 'https://cdn.ogabassey.com/image/width=128,height=128,quality=82,format=webp/core-assets/products/phone.avif',
          width: 128,
        },
      })
    );
  });

  it('renders condition badges for new and used items and navigates when image is pressed', () => {
    const item = createItem({ condition: 'NEW' });
    const { rerender } = renderCard(item);

    expect(screen.getByText('NEW')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Open product: iPhone 13 Pro'));
    expect(mockPush).toHaveBeenCalledWith('/product/iphone-13-pro-128gb');

    const usedItem = createItem({ condition: 'USED', id: 'cart-2' });
    rerender(
      <CartItemCard
        item={usedItem}
        handleQuantityChange={jest.fn()}
        handleRemoveItem={jest.fn()}
        toggleAssurance={jest.fn()}
        openItemNegotiation={jest.fn()}
        updateQuantity={jest.fn()}
        formatPrice={formatPrice}
        colors={Colors.light}
        surfaceInset="#F8FAFC"
        disabledIconColor="#94A3B8"
        negotiateSurface="#FFFFFF"
        negotiateBorder="#FECACA"
      />
    );

    expect(screen.getByText('USED')).toBeTruthy();
  });

  it('shows negotiated totals when negotiated price is present', () => {
    const item = createItem({
      negotiatedPrice: 800,
      negotiationStatus: 'accepted',
    });

    renderCard(item);

    expect(
      screen.getByText(formatPrice(item.price * item.quantity))
    ).toBeTruthy();
    expect(screen.getByText(formatPrice(800 * item.quantity))).toBeTruthy();
  });

  it('ignores stale negotiated prices on best-price items', () => {
    const item = createItem({
      brand: 'Tecno',
      name: 'Tecno Spark 50',
      negotiatedPrice: 800,
      negotiationStatus: 'accepted',
    });

    renderCard(item);

    expect(
      screen.getByText(formatPrice(item.price * item.quantity))
    ).toBeTruthy();
    expect(screen.queryByText(formatPrice(800 * item.quantity))).toBeNull();
  });

  it('renders the selected color label for named merchant colors', () => {
    const item = createItem({
      color: 'Blue Titanium',
      storage: '256GB',
    });

    renderCard(item);

    expect(screen.getByText('Blue Titanium')).toBeTruthy();
    expect(screen.getByText('256GB')).toBeTruthy();
  });

  it('falls back to variant_attributes color text when the top-level color field is missing', () => {
    const item = createItem({
      color: undefined,
      variant_attributes: {
        color: 'Jet Black',
        storage: '512GB',
      },
      storage: '512GB',
    });

    renderCard(item);

    expect(screen.getByText('Jet Black')).toBeTruthy();
    expect(screen.getByText('512GB')).toBeTruthy();
  });

  it('wires quantity controls and quantity input updates', () => {
    const item = createItem();
    const handleQuantityChange = jest.fn();
    const updateQuantity = jest.fn();

    renderCard(item, { handleQuantityChange, updateQuantity });

    fireEvent.press(
      screen.getByLabelText('Decrease quantity for iPhone 13 Pro')
    );
    fireEvent.press(
      screen.getByLabelText('Increase quantity for iPhone 13 Pro')
    );
    expect(handleQuantityChange).toHaveBeenNthCalledWith(1, item, -1);
    expect(handleQuantityChange).toHaveBeenNthCalledWith(2, item, 1);

    const quantityInput = screen.getByLabelText('Quantity input');
    fireEvent.changeText(quantityInput, '4');
    fireEvent(quantityInput, 'endEditing');
    expect(updateQuantity).toHaveBeenCalledWith(item.id, 4);
  });

  it('calls handleRemoveItem when remove button is pressed', () => {
    const item = createItem();
    const handleRemoveItem = jest.fn();

    renderCard(item, { handleRemoveItem });

    fireEvent.press(screen.getByLabelText('Remove iPhone 13 Pro from cart'));
    expect(handleRemoveItem).toHaveBeenCalledWith(item);
  });

  it('renders assurance pricing and toggles assurance state', () => {
    const item = createItem({
      hasAssurance: true,
      assuranceRate: 0.1,
      price: 2000,
      quantity: 2,
    });
    const toggleAssurance = jest.fn();

    renderCard(item, { toggleAssurance });

    expect(
      screen.getByText(`Screen & Liquid Damage +${formatPrice(400)}`)
    ).toBeTruthy();
    fireEvent.press(
      screen.getByLabelText('Toggle Ogabassey Assurance for iPhone 13 Pro')
    );
    expect(toggleAssurance).toHaveBeenCalledWith(item.id);
  });

  it('shows matched badge for accepted negotiation, otherwise negotiate button', () => {
    const acceptedItem = createItem({ negotiationStatus: 'accepted' });
    const openItemNegotiation = jest.fn();
    const { rerender } = renderCard(acceptedItem, { openItemNegotiation });

    expect(screen.getByText('Matched')).toBeTruthy();
    expect(screen.queryByText('Negotiate')).toBeNull();

    const pendingItem = createItem({
      negotiationStatus: undefined,
      id: 'cart-3',
      slug: 'iphone-13-pro-256gb',
    });
    rerender(
      <CartItemCard
        item={pendingItem}
        handleQuantityChange={jest.fn()}
        handleRemoveItem={jest.fn()}
        toggleAssurance={jest.fn()}
        openItemNegotiation={openItemNegotiation}
        updateQuantity={jest.fn()}
        formatPrice={formatPrice}
        colors={Colors.light}
        surfaceInset="#F8FAFC"
        disabledIconColor="#94A3B8"
        negotiateSurface="#FFFFFF"
        negotiateBorder="#FECACA"
      />
    );

    fireEvent.press(screen.getByText('Negotiate'));
    expect(openItemNegotiation).toHaveBeenCalledWith(pendingItem);
  });
});
