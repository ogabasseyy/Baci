import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import { WalletFundModal } from './WalletFundModal';
import { WalletPrimaryContext } from './WalletPrimaryContext';
import { createWalletContentProps } from './wallet-content.test-utils';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
let mockCapability: boolean | null = false;
jest.mock('expo-router', () => ({
  router: {
    back: () => mockBack(),
    canGoBack: () => mockCanGoBack,
    push: jest.fn(),
    replace: (href: string) => mockReplace(href),
  },
}));
jest.mock('@/hooks/use-copy-to-clipboard', () => ({
  useCopyToClipboard: () => ({ copyToClipboard: jest.fn(), feedback: null }),
}));
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: () => mockCapability,
}));

const creditWatch = {
  armCheck: jest.fn(),
  creditedAmount: null,
  reset: jest.fn(),
  returnCtaHref: undefined,
  status: 'idle' as const,
};
const account = {
  accountName: 'OGB / JOHN DOE',
  accountNumber: '9814644749',
  bankName: 'Provider Bank',
  provider: 'piggyvest',
};

function renderModal(
  primaryReady: boolean,
  fundReturnTo?: string,
  walletPrimaryUnsettled = false
) {
  const onResetFund = jest.fn();
  render(
    <WalletPrimaryContext.Provider value={primaryReady}>
      <WalletFundModal
        {...createWalletContentProps()}
        creditWatch={creditWatch}
        fundReturnTo={fundReturnTo as never}
        fundingAccount={account}
        merchantId="merchant-1"
        onResetFund={onResetFund}
        showFundPanel
        walletPrimaryUnsettled={walletPrimaryUnsettled}
      />
    </WalletPrimaryContext.Provider>
  );
  return onResetFund;
}

beforeEach(() => {
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack = true;
  mockCapability = false;
});

describe('bugfix: closing Add store credit strands the customer on a pushed wallet page', () => {
  it('returns straight to Airtime when the sheet is closed', () => {
    // Arrange: Airtime pushed the wallet with a store credit top-up.
    const onResetFund = renderModal(
      true,
      '/utilities/airtime?repeatAmount=500'
    );

    // Act
    fireEvent.press(screen.getByRole('button', { name: 'Close add money' }));

    // Assert
    expect(onResetFund).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('bugfix: opens the purchase when a deep link left no screen to go back to', () => {
    // Arrange: /wallet?action=fund&returnTo=/utilities/airtime opened cold.
    mockCanGoBack = false;
    const onResetFund = renderModal(true, '/utilities/airtime');

    // Act
    fireEvent.press(screen.getByRole('button', { name: 'Close add money' }));

    // Assert
    expect(onResetFund).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/utilities/airtime');
  });
});

describe('server keeps PiggyVest off', () => {
  it('keeps the customer on the wallet page after closing, as today', () => {
    const onResetFund = renderModal(false, '/utilities/airtime');

    fireEvent.press(screen.getByRole('button', { name: 'Close add money' }));

    expect(onResetFund).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('keeps a plain top-up on the wallet page', () => {
    renderModal(true);

    fireEvent.press(screen.getByRole('button', { name: 'Close add money' }));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('bugfix: unobserved rollout merchant with an unsettled wallet on a purchase top-up', () => {
  it('shows the store credit sheet and returns to the purchase on close', () => {
    // Arrange: capability not observed yet, PiggyVest check unsettled.
    mockCapability = null;
    renderModal(false, '/imei-check', true);

    // Act
    fireEvent.press(screen.getByRole('button', { name: 'Close add money' }));

    // Assert
    expect(screen.getByText('Add store credit')).toBeOnTheScreen();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('keeps the plain sheet where the server rules PiggyVest out', () => {
    mockCapability = false;
    renderModal(false, '/imei-check', true);

    expect(screen.queryByText('Add store credit')).toBeNull();
  });
});

describe('bugfix: restored legacy wallet before any PiggyVest verdict on a purchase top-up', () => {
  it('treats the purchase return as a store credit top-up and returns on close', () => {
    // Arrange: no verdict at all yet (hook and cache unknown).
    mockCapability = null;
    renderModal(false, '/utilities/airtime');

    // Act
    fireEvent.press(screen.getByRole('button', { name: 'Close add money' }));

    // Assert
    expect(screen.getByText('Add store credit')).toBeOnTheScreen();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('bugfix: card top-up offered before the PiggyVest verdict', () => {
  function renderWithoutAccount() {
    render(
      <WalletPrimaryContext.Provider value={false}>
        <WalletFundModal
          {...createWalletContentProps()}
          canCreateFundingAccount={false}
          creditWatch={creditWatch}
          fundingAccount={null}
          merchantId="merchant-1"
          onResetFund={jest.fn()}
          showFundPanel
        />
      </WalletPrimaryContext.Provider>
    );
  }

  it('hides card funding for a plain top-up while the verdict is unknown', () => {
    // Arrange: capability probe unanswered, no cached verdict, no account.
    mockCapability = null;

    // Act
    renderWithoutAccount();

    // Assert: a card charge now could settle as store credit.
    expect(screen.queryByText(/card/i)).toBeNull();
  });

  it('offers card funding once the server rules PiggyVest out', () => {
    mockCapability = false;
    observePiggyvestPrimaryCapability('merchant-1', false);

    renderWithoutAccount();

    expect(screen.getAllByText(/card/i).length).toBeGreaterThan(0);
    clearObservedPiggyvestPrimaryCapability();
  });
});

describe('bugfix: pilot sheet keeps PiggyVest after a rollback to not ready', () => {
  it('stops treating a purchase return as PiggyVest card-only once rolled back', () => {
    // Arrange: the hook still holds "PiggyVest on"; the live verdict has
    // been rolled back to "not ready" while the sheet is open.
    mockCapability = true;
    observePiggyvestPrimaryCapability('merchant-1', false);

    // Act
    renderModal(false, '/imei-check');

    // Assert: no PiggyVest store-credit sheet for a ruled-out merchant.
    expect(screen.queryByText('Add store credit')).toBeNull();
    clearObservedPiggyvestPrimaryCapability();
  });
});
