import { render, screen } from '@testing-library/react-native';
import type { CartItem } from '@/stores/cart-store';
import { CheckoutPrizeNotice } from './CheckoutPrizeNotice';

const paidLine = {
  id: 'paid-1',
  name: 'Phone case',
  price: 5000,
  product_id: 'product-2',
  quantity: 1,
  slug: 'phone-case',
} as CartItem;

const prizeLine = {
  ...paidLine,
  id: 'prize-1',
  name: 'iPhone XR',
  price: 0,
  voucher_award_id: 'award-1',
  voucher_token: 'token-1',
} as CartItem;

describe('CheckoutPrizeNotice', () => {
  it('bugfix: tells a winner the prize and its delivery are free', () => {
    render(<CheckoutPrizeNotice items={[prizeLine]} simulation={false} />);

    expect(screen.getByText('YOUR PRIZE IS FREE')).toBeOnTheScreen();
    expect(screen.getByText(/Delivery is on us/)).toBeOnTheScreen();
    expect(screen.getByText(/You will not be charged/)).toBeOnTheScreen();
  });

  it('shows nothing for an ordinary paid cart', () => {
    render(<CheckoutPrizeNotice items={[paidLine]} simulation={false} />);

    expect(screen.queryByText('YOUR PRIZE IS FREE')).toBeNull();
    expect(screen.queryByText('TEST SIMULATION')).toBeNull();
  });

  it('keeps the test-simulation banner in simulation mode', () => {
    render(<CheckoutPrizeNotice items={[prizeLine]} simulation />);

    expect(screen.getByText('TEST SIMULATION')).toBeOnTheScreen();
    expect(screen.queryByText('YOUR PRIZE IS FREE')).toBeNull();
  });
});
