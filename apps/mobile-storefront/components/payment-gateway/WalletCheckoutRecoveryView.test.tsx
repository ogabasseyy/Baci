import { jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type React from 'react';
import Colors from '@/constants/Colors';
import { openWalletPaystackCheckout } from '@/lib/open-wallet-paystack-checkout';
import { WalletCheckoutRecoveryView } from './WalletCheckoutRecoveryView';

const mockStackScreen = jest.fn((_props: unknown) => null);
jest.mock('expo-router', () => ({
  Stack: { Screen: (props: unknown) => mockStackScreen(props) },
}));
jest.mock('@/lib/open-wallet-paystack-checkout', () => ({
  openWalletPaystackCheckout: jest.fn(),
}));

const props = {
  authorizationUrl: 'https://checkout.paystack.com/session',
  colors: Colors.light,
  errorMessage: null,
  onBack: jest.fn(),
  onCheck: jest.fn(),
};

describe('WalletCheckoutRecoveryView', () => {
  beforeEach(() => jest.clearAllMocks());

  it('prevents repeated browser opens while the first one is in progress', async () => {
    let resolve!: () => void;
    jest.mocked(openWalletPaystackCheckout).mockReturnValueOnce(
      new Promise<void>((r) => {
        resolve = r;
      })
    );
    render(<WalletCheckoutRecoveryView {...props} />);
    const button = screen.getByRole('button', {
      name: 'Open Paystack in browser',
    });
    fireEvent.press(button);
    fireEvent.press(button);
    expect(openWalletPaystackCheckout).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Check funding status' })
    ).toBeDisabled();
    await act(async () => resolve());
    expect(
      screen.getByRole('button', { name: 'Check funding status' })
    ).toBeEnabled();
  });

  it('keeps status checking available if opening the browser fails', async () => {
    jest
      .mocked(openWalletPaystackCheckout)
      .mockRejectedValueOnce(new Error('unavailable'));
    render(<WalletCheckoutRecoveryView {...props} />);
    await act(async () => {
      fireEvent.press(
        screen.getByRole('button', { name: 'Open Paystack in browser' })
      );
      await Promise.resolve();
    });
    expect(
      screen.getByText(
        'Could not open Paystack. Check your funding status or try again.'
      )
    ).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', { name: 'Check funding status' })
    );
    expect(props.onCheck).toHaveBeenCalledTimes(1);
  });

  it('uses the payment exit confirmation when the header close button is pressed', () => {
    render(<WalletCheckoutRecoveryView {...props} />);
    const stackProps = mockStackScreen.mock.calls[0]?.[0] as {
      options: { headerLeft?: () => React.ReactElement };
    };
    const header = stackProps.options.headerLeft?.();
    expect(header).toBeDefined();
    if (!header) return;
    const rendered = render(header);
    fireEvent.press(
      rendered.getByRole('button', { name: 'Close payment error' })
    );
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});
