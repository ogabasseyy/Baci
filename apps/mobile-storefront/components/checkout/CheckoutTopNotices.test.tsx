import { render, screen } from '@testing-library/react-native';
import type { CartItem } from '@/stores/cart-store';
import { CheckoutTopNotices } from './CheckoutTopNotices';

const prizeLine: CartItem = {
  id: 'prize-1',
  name: 'iPhone XR',
  price: 0,
  product_id: 'product-1',
  quantity: 1,
  slug: 'iphone-xr',
  voucher_award_id: 'award-1',
  voucher_token: 'token-1',
};

const idleReview = { retry: jest.fn(), review: null, status: 'idle' as const };

describe('CheckoutTopNotices', () => {
  it('shows the free-prize notice for a winner', () => {
    render(
      <CheckoutTopNotices
        cartReview={idleReview}
        items={[prizeLine]}
        simulation={false}
        textColor="#000"
      />
    );

    expect(screen.getByText('YOUR PRIZE IS FREE')).toBeOnTheScreen();
  });

  it('keeps the cart-review warning and its retry action', () => {
    render(
      <CheckoutTopNotices
        cartReview={{ ...idleReview, status: 'error' }}
        items={[prizeLine]}
        simulation={false}
        textColor="#000"
      />
    );

    expect(
      screen.getByRole('button', { name: 'Retry cart review' })
    ).toBeOnTheScreen();
  });
});
