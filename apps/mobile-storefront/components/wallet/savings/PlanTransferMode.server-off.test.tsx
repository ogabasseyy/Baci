import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { expectNoPiggyvestUi } from '@/test-support/piggyvest-server-off.test-support';
import { PlanTransferMode } from './PlanTransferMode';

jest.mock('@/lib/is-hosted-staging-wallet-top-up-blocked', () => ({
  isHostedStagingTestPaymentsEnabled: () => false,
}));

function controller(overrides = {}) {
  return {
    effectiveInitialContribution: 5000,
    fetchExistingPlanFunding: jest.fn(),
    fetchPlanFunding: jest.fn(),
    fundingAccount: null,
    isSubmitting: false,
    openWalletFundingScreen: jest.fn(),
    planFundingError: null,
    planFundingPhase: 'idle',
    planFundingRequiresBvn: true,
    showTransferModal: true,
    submitBankTransferContribution: jest.fn(),
    ...overrides,
  };
}

// With no server verdict the sheet shows today's production content: the BVN
// check, the wallet actions and no PiggyVest-only UI.
describe('server keeps PiggyVest off', () => {
  it('asks for the BVN and offers the wallet actions', () => {
    const c = controller();
    render(<PlanTransferMode colors={Colors.light} controller={c as never} />);
    expect(screen.getByText('Fund your plan to continue')).toBeOnTheScreen();
    expect(screen.getByLabelText('BVN for plan account')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: 'Open wallet funding screen' })
    ).toBeOnTheScreen();
    expectNoPiggyvestUi();
    fireEvent.press(
      screen.getByRole('button', { name: 'Record wallet contribution' })
    );
    expect(c.submitBankTransferContribution).toHaveBeenCalledTimes(1);
  });

  it('falls back to the wallet when the plan account is unavailable', () => {
    const c = controller({ planFundingPhase: 'unavailable' });
    render(<PlanTransferMode colors={Colors.light} controller={c as never} />);
    expect(
      screen.getByText(
        /Fund your wallet instead and record the contribution below/
      )
    ).toBeOnTheScreen();
    expect(c.fetchExistingPlanFunding).not.toHaveBeenCalled();
  });
});
