import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { expectNoPiggyvestUi } from '@/test-support/piggyvest-server-off.test-support';
import { PlanFundingLookup } from './PlanFundingLookup';

// Server off or no verdict: the plan setup asks for a BVN, as in production.
describe('server keeps PiggyVest off', () => {
  it.each([
    true,
    undefined,
  ])('collects a BVN and offers only the legacy readiness check (requiresBvn %s)', (planFundingRequiresBvn) => {
    const onFetch = jest.fn();
    const onCheckStatus = jest.fn();
    render(
      <PlanFundingLookup
        colors={Colors.light}
        controller={{
          planFundingRequiresBvn: planFundingRequiresBvn as boolean,
          planFundingPhase: 'idle',
          planFundingError: null,
          isSubmitting: false,
        }}
        bvn=""
        earnInterest={false}
        onBvnChange={jest.fn()}
        onCheckStatus={onCheckStatus}
        onEarnInterestChange={jest.fn()}
        onFetch={onFetch}
      />
    );
    expect(screen.getByLabelText('BVN for plan account')).toBeOnTheScreen();
    expect(screen.queryByText(/verified PiggyVest profile/)).toBeNull();
    fireEvent.press(
      screen.getByRole('button', { name: 'Check plan readiness' })
    );
    expect(onFetch).toHaveBeenCalledTimes(1);
    expect(onCheckStatus).not.toHaveBeenCalled();
  });

  it('shows no account number', () => {
    render(
      <PlanFundingLookup
        colors={Colors.light}
        controller={{
          planFundingRequiresBvn: true,
          planFundingPhase: 'idle',
          planFundingError: null,
          isSubmitting: false,
        }}
        bvn=""
        earnInterest={false}
        onBvnChange={jest.fn()}
        onEarnInterestChange={jest.fn()}
        onFetch={jest.fn()}
      />
    );
    expectNoPiggyvestUi();
  });
});
