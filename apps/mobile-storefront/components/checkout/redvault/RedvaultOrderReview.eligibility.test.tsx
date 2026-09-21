import { render, screen } from '@testing-library/react-native';
import { OrderResponseSchema } from '@/services/orders.schemas';
import { RedvaultOrderReview } from './RedvaultOrderReview';
import { redvaultOrderResponse } from './redvault-order-review.test-utils';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/services/redvault', () => ({
  getCheckoutAuthorizationHeaders: jest.fn(),
}));

it('does not offer initialization for an all-excluded persisted quote', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  global.fetch = fetchMock;
  try {
    render(
      <RedvaultOrderReview
        input={{
          orderResponse: OrderResponseSchema.parse({
            ...redvaultOrderResponse,
            order: { ...redvaultOrderResponse.order, total: 122.5 },
            redvault: {
              status: 'pending',
              quote: {
                ...redvaultOrderResponse.redvault.quote,
                eligible_subtotal_kobo: 0,
                ineligible_subtotal_kobo: 11000,
                discount_kobo: 0,
                payable_kobo: 12250,
              },
            },
          }),
          customerEmail: 'ada@example.com',
          customerName: 'Ada',
          customerPhone: '08012345678',
        }}
        onClose={jest.fn()}
      />
    );
    expect(
      screen.queryByRole('button', { name: 'Continue to secure UBA payment' })
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    global.fetch = originalFetch;
  }
});
