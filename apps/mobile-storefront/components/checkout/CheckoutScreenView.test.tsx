import { screen, waitFor } from '@testing-library/react-native';
import {
  mockTrackCheckoutStarted,
  renderCheckoutScreen,
  setupCheckoutTest,
  teardownCheckoutTest,
} from '../../__tests__/app/checkout.test-utils';
import { renderCheckoutScreenView } from '../../__tests__/app/checkout-screen-view.test-utils';

jest.mock('@/components/storefront/GadgetPattern', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    GadgetPattern: () => <Text>GadgetPattern</Text>,
  };
});

describe('CheckoutScreenView', () => {
  beforeEach(() => {
    setupCheckoutTest();
  });

  afterEach(() => {
    teardownCheckoutTest();
  });

  it('renders the checkout header through the route shell', () => {
    renderCheckoutScreen();
    expect(screen.getByText('Checkout')).toBeOnTheScreen();
  });

  it('does not emit checkout-start analytics for a prize simulation', async () => {
    renderCheckoutScreenView({
      prizeSimulation: {
        item: {
          id: 'test-prize',
          name: 'iPhone XR',
          price: 0,
          product_id: 'product-1',
          quantity: 1,
          slug: 'iphone-xr',
        },
        onComplete: jest.fn(),
      },
    });

    await Promise.resolve();
    expect(mockTrackCheckoutStarted).not.toHaveBeenCalled();
  });

  it('keeps checkout-start analytics enabled for a normal checkout', async () => {
    renderCheckoutScreenView();

    await waitFor(() => {
      expect(mockTrackCheckoutStarted).toHaveBeenCalledTimes(1);
    });
  });
});
