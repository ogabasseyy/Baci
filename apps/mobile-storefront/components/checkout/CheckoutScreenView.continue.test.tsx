import { expect, type jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { BRAND } from '@/constants/Colors';
import {
  renderCheckoutScreen,
  setupCheckoutTest,
  teardownCheckoutTest,
} from '../../__tests__/app/checkout.test-utils';

describe('CheckoutScreenView address continuation', () => {
  beforeEach(() => {
    setupCheckoutTest();
  });

  afterEach(() => {
    teardownCheckoutTest();
  });

  it('keeps Continue disabled while contact details are incomplete', () => {
    renderCheckoutScreen();

    const continueButton = screen.getByRole('button', {
      name: 'Continue to payment',
    });

    expect(continueButton.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(continueButton);
    expect(screen.getByLabelText('checkout-step')).toHaveTextContent(
      'step:address'
    );
  });

  it('waits for blur after a guest corrects a previously invalid field', async () => {
    renderCheckoutScreen();
    const firstName = screen.getByPlaceholderText('E.g. John');

    fireEvent.changeText(firstName, 'A');
    fireEvent(firstName, 'blur');
    fireEvent.changeText(screen.getByPlaceholderText('E.g. Doe'), 'Lovelace');
    fireEvent(screen.getByPlaceholderText('E.g. Doe'), 'blur');
    fireEvent.changeText(
      screen.getByPlaceholderText('e.g. 08012345678'),
      '08031234567'
    );
    fireEvent(screen.getByPlaceholderText('e.g. 08012345678'), 'blur');
    fireEvent.changeText(
      screen.getByPlaceholderText('john@example.com'),
      'ada@example.com'
    );
    fireEvent(screen.getByPlaceholderText('john@example.com'), 'blur');

    fireEvent(firstName, 'focus');
    fireEvent.changeText(firstName, 'Ada');
    expect(
      screen.queryByPlaceholderText('Start typing your address…')
    ).toBeNull();

    fireEvent(firstName, 'blur');
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText('Start typing your address…')
      ).toBeTruthy();
    });
  });

  it('turns Continue brand red when a complete address has a fresh road quote', async () => {
    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    fetchMock.mockImplementation(async (input) => {
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (requestUrl.includes('/api/shipping/locations?state=')) {
        return {
          json: async () => ({
            locations: [{ city: 'Ikeja', state: 'Lagos' }],
          }),
          ok: true,
        } as Response;
      }

      if (requestUrl.includes('/api/shipping/locations')) {
        return {
          json: async () => ({ states: ['Lagos'] }),
          ok: true,
        } as Response;
      }

      if (requestUrl.includes('/api/shipping/quotes')) {
        return {
          json: async () => ({
            quotes: {
              all: [
                {
                  displayName: 'GIGL GoStandard',
                  id: 'gigl-road',
                  price: 3500,
                  provider: 'GIGL',
                  serviceTier: 'GoStandard',
                },
              ],
            },
          }),
          ok: true,
        } as Response;
      }

      return {
        json: async () => ({}),
        ok: true,
      } as Response;
    });

    renderCheckoutScreen();
    fireEvent.changeText(screen.getByPlaceholderText('E.g. John'), 'Ada');
    fireEvent(screen.getByPlaceholderText('E.g. John'), 'blur');
    fireEvent.changeText(screen.getByPlaceholderText('E.g. Doe'), 'Lovelace');
    fireEvent(screen.getByPlaceholderText('E.g. Doe'), 'blur');
    fireEvent.changeText(
      screen.getByPlaceholderText('e.g. 08012345678'),
      '08031234567'
    );
    fireEvent(screen.getByPlaceholderText('e.g. 08012345678'), 'blur');
    fireEvent.changeText(
      screen.getByPlaceholderText('john@example.com'),
      'ada@example.com'
    );
    expect(
      screen.queryByPlaceholderText('Start typing your address…')
    ).toBeNull();
    fireEvent(screen.getByPlaceholderText('john@example.com'), 'blur');

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText('Start typing your address…')
      ).toBeTruthy();
    });
    fireEvent.changeText(
      screen.getByPlaceholderText('Start typing your address…'),
      'No. 5 Example Plaza'
    );
    fireEvent.press(screen.getByRole('button', { name: 'Mock select State' }));
    fireEvent.press(screen.getByRole('button', { name: 'Mock select City' }));

    await waitFor(() => {
      const continueButton = screen.getByRole('button', {
        name: 'Continue to payment',
      });

      expect(continueButton.props.accessibilityState.disabled).toBe(false);
      expect(continueButton.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ backgroundColor: BRAND.primary }),
        ])
      );
    });
  });
});
