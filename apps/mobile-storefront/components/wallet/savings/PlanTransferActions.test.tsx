import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { PlanTransferActions } from './PlanTransferActions';

describe('PlanTransferActions account readiness gate', () => {
  const controller = {
    planFundingPhase: 'idle' as const,
    planFundingAccounts: [],
    isSubmitting: false,
    openWalletFundingScreen: jest.fn(),
    submitBankTransferContribution: jest.fn(),
    isPrimaryMerchant: false,
  };

  it.each([
    'idle',
    'loading',
    'pending',
    'unavailable',
    'error',
  ] as const)('does not offer transfer confirmation while the account is %s', (phase) => {
    const confirm = jest.fn();
    render(
      <PlanTransferActions
        colors={Colors.light}
        controller={{ ...controller, planFundingPhase: phase }}
        onConfirmTransfer={confirm}
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Confirm plan transfer' })
    ).toBeNull();
    expect(screen.queryByText("I've funded wallet")).toBeNull();
    if (phase === 'unavailable' || phase === 'error') {
      expect(
        screen.getByRole('button', { name: 'Record wallet contribution' })
      ).toBeOnTheScreen();
    } else {
      expect(
        screen.queryByRole('button', { name: 'Record wallet contribution' })
      ).toBeNull();
    }
    fireEvent.press(
      screen.getByRole('button', { name: 'Open wallet funding screen' })
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not offer confirmation for a ready response without an account', () => {
    render(
      <PlanTransferActions
        colors={Colors.light}
        controller={{ ...controller, planFundingPhase: 'ready' }}
        onConfirmTransfer={jest.fn()}
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Confirm plan transfer' })
    ).toBeNull();
  });

  it.each([
    'unavailable',
    'error',
  ] as const)('offers exact-goal wallet contribution recovery for a non-primary plan when account is %s', (phase) => {
    const submit = jest.fn();
    render(
      <PlanTransferActions
        colors={Colors.light}
        controller={{
          ...controller,
          planFundingPhase: phase,
          submitBankTransferContribution: submit,
        }}
        onConfirmTransfer={jest.fn()}
      />
    );

    fireEvent.press(
      screen.getByRole('button', { name: 'Record wallet contribution' })
    );
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('keeps primary plans on the wallet handoff without generic contribution recovery', () => {
    render(
      <PlanTransferActions
        colors={Colors.light}
        controller={{
          ...controller,
          planFundingPhase: 'error',
          isPrimaryMerchant: true,
        }}
        onConfirmTransfer={jest.fn()}
      />
    );

    expect(
      screen.queryByRole('button', { name: 'Record wallet contribution' })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Open wallet funding screen' })
    ).toBeOnTheScreen();
  });
});
