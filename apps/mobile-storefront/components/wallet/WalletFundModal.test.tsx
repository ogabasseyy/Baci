import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { WalletFundModal } from './WalletFundModal';
import { createWalletContentProps } from './wallet-content.test-utils';

jest.mock('./PiggyvestWalletSetupPanel', () => {
  const { Text } = require('react-native');
  return {
    PiggyvestWalletSetupPanel: () => <Text>Primary setup panel</Text>,
  };
});

const mockUseCapability = jest.fn<(...args: unknown[]) => unknown>();
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: (...args: unknown[]) =>
    mockUseCapability(...args),
}));

const creditWatch = {
  armCheck: jest.fn(),
  creditedAmount: null,
  reset: jest.fn(),
  returnCtaHref: undefined,
  status: 'idle' as const,
};

describe('WalletFundModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCapability.mockReturnValue(null);
  });
  it('shows the primary setup only while the server confirms the capability', () => {
    mockUseCapability.mockReturnValue(true);
    const props = createWalletContentProps();
    render(
      <WalletFundModal
        {...props}
        creditWatch={creditWatch}
        fundingAccount={null}
        merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
        showFundPanel
      />
    );
    expect(screen.getByText('Primary setup panel')).toBeOnTheScreen();
  });
  it('falls back to the legacy fund panel when primary is unconfigured', () => {
    mockUseCapability.mockReturnValue(false);
    const props = createWalletContentProps();
    render(
      <WalletFundModal
        {...props}
        creditWatch={creditWatch}
        fundingAccount={null}
        merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
        showFundPanel
      />
    );
    expect(screen.queryByText('Primary setup panel')).toBeNull();
    expect(screen.getByText('Add Money')).toBeOnTheScreen();
  });
  it('shows savings return guidance when funding an existing plan', () => {
    const props = createWalletContentProps();
    render(
      <WalletFundModal
        {...props}
        creditWatch={creditWatch}
        fundReturnTo="/wallet?action=savings"
        showFundPanel
      />
    );

    expect(screen.getByText(/return to this savings plan/i)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Close add money' }));
    expect(props.onResetFund).toHaveBeenCalledTimes(1);
  });

  it('does not show a funding panel when it is closed', () => {
    const props = createWalletContentProps();
    render(
      <WalletFundModal
        {...props}
        creditWatch={creditWatch}
        showFundPanel={false}
      />
    );

    expect(screen.queryByText('Add Money')).toBeNull();
  });

  it('keeps the Add Money payment sheet above the keyboard', () => {
    const props = createWalletContentProps();
    render(
      <WalletFundModal
        {...props}
        creditWatch={creditWatch}
        fundAmount="5000"
        showFundPanel
      />
    );

    expect(screen.getByTestId('keyboard-container')).toHaveProp(
      'automaticOffset',
      true
    );
    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeOnTheScreen();
  });
});
