import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import {
  PaymentMethodSelector,
  type PaymentMethodType,
} from './PaymentMethodSelector';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const noop = () => undefined;

function renderSelector(props: {
  walletBalance: number;
  walletIsStoreCredit?: boolean;
}) {
  render(
    <PaymentMethodSelector
      selectedMethod={'paystack' as PaymentMethodType}
      onSelectMethod={noop}
      selectedTab="full"
      onSelectTab={noop}
      orderTotal={1000}
      walletMode="orders"
      walletOrderTotal={1000}
      onWalletToggle={noop}
      {...props}
    />
  );
}

describe('checkout wallet row', () => {
  it('keeps the wallet wording when the server keeps PiggyVest off', () => {
    renderSelector({ walletBalance: 800 });

    expect(
      screen.getByRole('checkbox', { name: /use wallet credit/i })
    ).toBeOnTheScreen();
    expect(screen.queryByText(/store credit/i)).toBeNull();
  });

  it('labels the older balance store credit for a PiggyVest customer', () => {
    renderSelector({ walletBalance: 800, walletIsStoreCredit: true });

    expect(
      screen.getByRole('checkbox', { name: /use store credit/i })
    ).toBeOnTheScreen();
    expect(screen.getByText('₦800 from store credit · ₦200 from card'));
    expect(screen.queryByText(/wallet/i)).toBeNull();
  });

  it('shows no store credit row at ₦0, so the customer pays directly', () => {
    renderSelector({ walletBalance: 0, walletIsStoreCredit: true });

    expect(screen.queryByText(/store credit/i)).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /wallet/i })).toBeNull();
  });
});
