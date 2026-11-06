import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { WalletFundModal } from './WalletFundModal';
import { WalletPrimaryContext } from './WalletPrimaryContext';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('@/hooks/use-copy-to-clipboard', () => ({
  useCopyToClipboard: () => ({ copyToClipboard: jest.fn(), feedback: null }),
}));
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: () => null,
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
const CARD = 'Fund with card instead';

function renderModal(primaryReady: boolean, fundReturnTo?: string) {
  render(
    <WalletPrimaryContext.Provider value={primaryReady}>
      <WalletFundModal
        {...createWalletContentProps()}
        creditWatch={creditWatch}
        fundReturnTo={fundReturnTo as never}
        fundingAccount={account}
        showFundPanel
      />
    </WalletPrimaryContext.Provider>
  );
}

describe('WalletFundModal card option with the PiggyVest wallet ready', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hides card funding for a savings-shortfall return', () => {
    renderModal(true, '/wallet?action=savings');
    expect(screen.getByText('9814644749')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: CARD })).toBeNull();
  });

  it('hides card funding for a plain top-up', () => {
    renderModal(true);
    expect(screen.queryByRole('button', { name: CARD })).toBeNull();
  });

  it('keeps card funding for the legacy-funded IMEI check return', () => {
    renderModal(true, '/imei-check');
    expect(screen.getByRole('button', { name: CARD })).toBeOnTheScreen();
  });

  it('keeps card funding for legacy customers', () => {
    renderModal(false, '/wallet?action=savings');
    expect(screen.getByRole('button', { name: CARD })).toBeOnTheScreen();
  });
});
