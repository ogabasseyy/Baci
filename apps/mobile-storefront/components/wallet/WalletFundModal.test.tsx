import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { DraggableModalSheet } from '@/components/ui/DraggableModalSheet';
import Colors, { BRAND } from '@/constants/Colors';
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
  it.each([
    false,
    true,
  ])('keeps a single shared sheet handle when embedded=%s', (embedded) => {
    const props = createWalletContentProps();
    const modal = (
      <WalletFundModal
        {...props}
        colors={Colors.dark}
        creditWatch={creditWatch}
        embedded={embedded}
        showFundPanel
      />
    );
    render(
      embedded ? (
        <DraggableModalSheet
          visible
          backgroundColor={Colors.dark.card}
          onClose={jest.fn()}
        >
          {modal}
        </DraggableModalSheet>
      ) : (
        modal
      )
    );

    const sheets = screen.getAllByTestId('gorhom-sheet');
    expect(sheets).toHaveLength(1);
    expect(sheets[0].props.handleIndicatorStyle).toEqual(
      expect.objectContaining({ backgroundColor: BRAND.primary, width: 40 })
    );
    const innerHandles = screen.UNSAFE_getAllByType(View).filter((view) => {
      const style = StyleSheet.flatten(view.props.style);
      return style?.width === 36 && style?.height === 4;
    });
    expect(innerHandles).toHaveLength(0);
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
  it('shows primary setup while a legacy account is retained pending onboarding', () => {
    mockUseCapability.mockReturnValue(true);
    const props = createWalletContentProps();
    render(
      <WalletFundModal
        {...props}
        creditWatch={creditWatch}
        fundingAccount={{
          accountName: 'Synthetic User',
          accountNumber: '9000000001',
          bankName: 'Synthetic Bank',
          provider: 'paystack',
        }}
        merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
        showFundPanel
      />
    );
    expect(screen.getByText('Primary setup panel')).toBeOnTheScreen();
  });
  it('shows the fund panel once the primary account is provisioned', () => {
    mockUseCapability.mockReturnValue(true);
    const props = createWalletContentProps();
    render(
      <WalletFundModal
        {...props}
        creditWatch={creditWatch}
        needsPhone
        fundingAccount={{
          accountName: 'Synthetic User',
          accountNumber: '9000000002',
          bankName: 'PiggyVest',
          provider: 'piggyvest',
        }}
        merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
        showFundPanel
      />
    );
    expect(screen.queryByText('Primary setup panel')).toBeNull();
    expect(screen.getByText('Add Money')).toBeOnTheScreen();
    expect(screen.getByText('9000000002')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Phone number')).toBeNull();
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

  it('shows savings return guidance for a parameterized primary handoff', () => {
    const props = createWalletContentProps();
    render(
      <WalletFundModal
        {...props}
        creditWatch={creditWatch}
        fundReturnTo="/wallet?action=savings&savingsGoalId=owned-goal&savingsAmount=1000"
        showFundPanel
      />
    );

    expect(screen.getByText(/return to this savings plan/i)).toBeOnTheScreen();
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

    expect(screen.getByTestId('gorhom-sheet')).toHaveProp(
      'keyboardBehavior',
      'interactive'
    );
    expect(screen.getByTestId('gorhom-sheet')).toHaveProp(
      'keyboardBlurBehavior',
      'restore'
    );
    expect(
      screen.getByRole('button', { name: 'Continue to payment' })
    ).toBeOnTheScreen();
  });
});
