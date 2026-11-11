import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import {
  mockAlert,
  mockCreateOrder,
  mockPaymentSettings,
  mockUseMerchantPaymentSettings,
  renderCheckoutScreen,
  setupCheckoutTest,
  teardownCheckoutTest,
} from './checkout.test-utils';
import { fillCheckoutContact } from './checkout-contact.test-utils';

function fillAddressAndContinueToPayment() {
  fillCheckoutContact();
  fireEvent.changeText(
    screen.getByPlaceholderText('Start typing your address…'),
    'No. 5 Example Plaza'
  );
  fireEvent.press(screen.getByRole('button', { name: 'Mock select State' }));
  fireEvent.press(screen.getByRole('button', { name: 'Mock select City' }));
  fireEvent.press(
    screen.getByRole('button', { name: 'Select pickup station' })
  );
  fireEvent.press(screen.getByRole('button', { name: 'Continue to payment' }));
}

function enableBnplPaymentSettings() {
  mockUseMerchantPaymentSettings.mockReturnValue({
    data: {
      ...mockPaymentSettings,
      credpal_enabled: false,
      credit_direct_enabled: true,
      juicyway_enabled: false,
      klump_enabled: true,
      klump_max_amount: 5_000_000,
      klump_min_amount: 1_000,
      korapay_enabled: false,
      pay_on_delivery_enabled: false,
      paystack_enabled: true,
      vat_rate: 0,
      vat_registration_status: 'unregistered',
    },
  });
}

describe('checkout retry identity', () => {
  beforeEach(() => {
    setupCheckoutTest();
  });

  afterEach(() => {
    teardownCheckoutTest();
  });

  it('blocks retired Klump after a Credit Direct attempt', async () => {
    enableBnplPaymentSettings();
    renderCheckoutScreen();
    fillAddressAndContinueToPayment();
    await waitFor(() => {
      expect(screen.getByText('Payment Method')).toBeOnTheScreen();
    });
    fireEvent.press(
      screen.getByRole('button', { name: 'Mock select Credit Direct' })
    );
    await waitFor(() => {
      expect(
        screen.getByText('Selected payment: credit_direct')
      ).toBeOnTheScreen();
    });
    fireEvent.press(screen.getByRole('button', { name: 'Continue to review' }));
    await waitFor(() => {
      expect(screen.getByText('Review Order')).toBeOnTheScreen();
    });
    fireEvent.press(screen.getByRole('button', { name: /Place order for/i }));
    await waitFor(() => {
      expect(mockCreateOrder).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateOrder.mock.calls[0]?.[0]).not.toHaveProperty(
      'idempotency_key'
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Edit payment method' })
    );
    fireEvent.press(screen.getByRole('button', { name: 'Mock select Klump' }));
    await waitFor(() => {
      expect(screen.getByText('Selected payment: klump')).toBeOnTheScreen();
    });
    fireEvent.press(screen.getByRole('button', { name: 'Continue to review' }));
    fireEvent.press(screen.getByRole('button', { name: /Place order for/i }));
    await waitFor(() => {
      expect(mockAlert).toHaveBeenCalledWith(
        'Klump unavailable',
        expect.any(String),
        expect.any(Array)
      );
      expect(mockCreateOrder).toHaveBeenCalledTimes(1);
    });
  }, 30_000);
});
