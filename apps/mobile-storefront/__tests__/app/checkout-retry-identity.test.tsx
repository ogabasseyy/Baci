import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import {
  mockAlert,
  mockCreateOrder,
  mockPaymentSettings,
  mockRouterPush,
  mockTrackError,
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

  it('replaces a rejected GIG quote before launching Credit Direct', async () => {
    enableBnplPaymentSettings();
    const fallbackFetch = global.fetch;
    const quoteRequests: Array<{
      method: string | undefined;
      quoteId: string;
      address: string;
    }> = [];
    global.fetch = jest.fn(async (input, init) => {
      if (!String(input).endsWith('/api/shipping/quotes')) {
        return fallbackFetch(input, init);
      }
      const { receiver } = JSON.parse(String(init?.body));
      const quoteId = quoteRequests.length
        ? '7a9db688-8c3b-41c4-8f16-7fc24a045c13'
        : '5ec1bd0e-7838-4379-a9e6-d47167f1d0c9';
      quoteRequests.push({
        method: init?.method,
        quoteId,
        address: receiver.address,
      });
      return {
        ok: true,
        json: async () => ({
          receiverState: 'Lagos',
          quotes: {
            all: [
              {
                id: quoteId,
                provider: 'GIGL',
                price: 2500,
                displayName: 'GIG Standard',
              },
            ],
          },
        }),
      } as Response;
    });
    const { OrderError } =
      jest.requireMock<typeof import('@/services/orders')>('@/services/orders');
    mockCreateOrder.mockRejectedValueOnce(
      new OrderError(
        'The saved shipping quote no longer matches this delivery address.',
        'VALIDATION_ERROR',
        'INTERNATIONAL_QUOTE_DESTINATION_MISMATCH'
      )
    );

    const advanceAndSubmit = async () => {
      fireEvent.press(
        screen.getByRole('button', { name: 'Continue to payment' })
      );
      fireEvent.press(
        await screen.findByRole('button', { name: 'Mock select Credit Direct' })
      );
      await screen.findByText('Selected payment: credit_direct');
      fireEvent.press(
        screen.getByRole('button', { name: 'Continue to review' })
      );
      fireEvent.press(
        await screen.findByRole('button', { name: /Place order for/i })
      );
    };

    renderCheckoutScreen();
    fillCheckoutContact();
    fireEvent.changeText(
      screen.getByPlaceholderText('Start typing your address…'),
      '3 Example Street'
    );
    fireEvent.press(screen.getByRole('button', { name: 'Mock select State' }));
    fireEvent.press(screen.getByRole('button', { name: 'Mock select City' }));
    await waitFor(() => expect(quoteRequests).toHaveLength(1));
    await advanceAndSubmit();

    await waitFor(() => {
      expect(mockAlert).toHaveBeenCalledWith(
        'Delivery quote changed',
        expect.any(String),
        expect.any(Array)
      );
      expect(screen.getByLabelText('checkout-step')).toHaveTextContent(
        'step:address'
      );
      expect(quoteRequests).toHaveLength(2);
    });
    expect(quoteRequests.map(({ method }) => method)).toEqual(['POST', 'POST']);
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(mockTrackError).toHaveBeenCalledWith(
      'checkout_shipping_quote_rejected',
      'Delivery quote rejected before order creation',
      {
        error_code: 'INTERNATIONAL_QUOTE_DESTINATION_MISMATCH',
        payment_method: 'credit_direct',
      }
    );

    await advanceAndSubmit();
    await waitFor(() =>
      expect(mockRouterPush).toHaveBeenCalledWith({
        pathname: '/bnpl-checkout',
        params: expect.objectContaining({
          gateway: 'credit_direct',
          shipping: '2500.00',
          orderId: 'order-1',
        }),
      })
    );
    expect(mockCreateOrder).toHaveBeenCalledTimes(2);
    for (const [index, quote] of quoteRequests.entries()) {
      expect(mockCreateOrder.mock.calls[index]?.[0]).toMatchObject({
        payment_method: 'credit_direct',
        selected_quote_id: quote.quoteId,
        shipping_fee: 2500,
        shipping_address: {
          address: quote.address,
          city: 'Ikeja',
          state: 'Lagos',
        },
      });
    }
  }, 30_000);

  it('delegates BNPL retry identity to the order service when switching providers', async () => {
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
      expect(mockCreateOrder).toHaveBeenCalledTimes(2);
    });
    expect(mockCreateOrder.mock.calls[1]?.[0]).not.toHaveProperty(
      'idempotency_key'
    );
  }, 30_000);
});
