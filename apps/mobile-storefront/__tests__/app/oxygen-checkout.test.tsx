import { fireEvent, render, screen } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import OxygenCheckoutRoute from '@/app/oxygen-checkout';
import { OxygenCheckoutScreen } from '@/components/oxygen-checkout/OxygenCheckoutScreen';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));
jest.mock('@/components/oxygen-checkout/OxygenCheckoutScreen', () => ({
  OxygenCheckoutScreen: jest.fn(() => null),
}));

const order = '123e4567-e89b-12d3-a456-426614174000';

beforeEach(() => jest.clearAllMocks());

it.each([
  undefined,
  'invalid-order',
  [order, '123e4567-e89b-12d3-a456-426614174001'],
])('offers order history for an invalid checkout link %j', (orderId) => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ orderId });
  render(<OxygenCheckoutRoute />);

  expect(OxygenCheckoutScreen).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'View my orders' }));
  expect(router.replace).toHaveBeenCalledWith('/orders');
});

it('opens a validated order when the router supplies one value in an array', () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ orderId: [order] });
  render(<OxygenCheckoutRoute />);

  expect(OxygenCheckoutScreen).toHaveBeenCalledWith(
    { orderId: order },
    undefined
  );
  expect(router.replace).not.toHaveBeenCalled();
});
