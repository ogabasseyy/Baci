// Server-off release-gate test: PiggyVest stays off server-side; the
// component must render and behave exactly as in production.
import { fireEvent, render, screen } from '@testing-library/react-native';

let mockFlagEnabled = true;

jest.mock('@/constants/wallet-funding', () => ({
  get WALLET_FUNDING_CHECKING_STATE_ENABLED() {
    return mockFlagEnabled;
  },
}));

const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (href: unknown) => mockRouterPush(href) },
}));

import type { WalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { WalletCreditCheckPanel } from './WalletCreditCheckPanel';

function createWatch(
  overrides: Partial<WalletCreditWatch> = {}
): WalletCreditWatch {
  return {
    armCheck: jest.fn(),
    creditedAmount: null,
    reset: jest.fn(),
    returnCtaHref: undefined,
    status: 'idle',
    ...overrides,
  };
}

function renderPanel(watch: WalletCreditWatch) {
  return render(
    <WalletCreditCheckPanel
      accentColor="#123456"
      textColor="#000000"
      watch={watch}
    />
  );
}

describe('WalletCreditCheckPanel (server off)', () => {
  beforeEach(() => {
    mockFlagEnabled = true;
    jest.clearAllMocks();
  });

  it('renders nothing while the dark-launch flag is off', () => {
    mockFlagEnabled = false;
    const { toJSON } = renderPanel(createWatch());

    expect(toJSON()).toBeNull();
  });

  it('resets to idle from the credited state so a later transfer can be checked', () => {
    const reset = jest.fn();
    renderPanel(
      createWatch({ status: 'credited', creditedAmount: 2500, reset })
    );

    fireEvent.press(screen.getByRole('button', { name: 'Done' }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('arms the watch when the customer confirms they transferred', () => {
    const armCheck = jest.fn();
    renderPanel(createWatch({ armCheck }));

    fireEvent.press(screen.getByRole('button', { name: /I've transferred/i }));

    expect(armCheck).toHaveBeenCalledTimes(1);
  });

  it('shows the in-flight copy while checking', () => {
    renderPanel(createWatch({ status: 'checking' }));

    expect(screen.getByText(/Checking for your transfer/i)).toBeTruthy();
  });

  it('deep-links back to the purchase only when credited with a return href', () => {
    const returnCtaHref =
      '/utilities/airtime?repeatAmount=1000' as WalletReturnHref;
    renderPanel(
      createWatch({ status: 'credited', creditedAmount: 2500, returnCtaHref })
    );

    expect(screen.getByText('Wallet credited')).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', { name: 'Return to your purchase' })
    );

    expect(mockRouterPush).toHaveBeenCalledWith(returnCtaHref);
  });

  it('omits the return CTA when credited without a return href', () => {
    renderPanel(createWatch({ status: 'credited', creditedAmount: 2500 }));

    expect(screen.getByText('Wallet credited')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Return to your purchase' })
    ).toBeNull();
  });

  it('re-arms the watch from a timed-out state and never claims credited', () => {
    const armCheck = jest.fn();
    renderPanel(createWatch({ status: 'timedOut', armCheck }));

    expect(screen.queryByText(/credited/i)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Check again' }));

    expect(armCheck).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});
