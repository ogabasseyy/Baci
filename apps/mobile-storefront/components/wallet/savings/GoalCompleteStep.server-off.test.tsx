import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { GoalCompleteStep, goalCompleteBreakdown } from './GoalCompleteStep';
import type { GoalLifecycleStep } from './use-goal-lifecycle';

const goal = {
  contribution_amount: 5000,
  contribution_frequency: 'weekly',
  current_amount: 789360,
  id: 'goal-1',
  maturity_date: '2026-11-01',
  principal_amount: 780000,
  source_mode: 'manual',
  status: 'completed',
  target_amount: 780000,
  title: 'iPhone 15',
} satisfies WalletActiveSavingsGoal;

type Flow = Parameters<typeof GoalCompleteStep>[0]['flow'];
function makeFlow(
  step: GoalLifecycleStep = 'review',
  extra: Partial<Flow> = {}
): Flow {
  return {
    step,
    message: null,
    canStartAgain: false,
    needsSignIn: false,
    begin: jest.fn(async () => {}),
    retryPin: jest.fn(async () => {}),
    checkAgain: jest.fn(async () => {}),
    ...extra,
  };
}

function renderStep(flow = makeFlow()) {
  const handlers = {
    onDone: jest.fn(),
    onNotNow: jest.fn(),
    onSignIn: jest.fn(),
  };
  render(
    <GoalCompleteStep
      colors={Colors.light}
      flow={flow}
      goal={goal}
      {...handlers}
    />
  );
  return handlers;
}

describe('Complete goal inside the savings sheet, server off', () => {
  it('keeps the interest: everything in the goal moves to the wallet', () => {
    expect(goalCompleteBreakdown(goal)).toEqual({
      saved: 780000,
      interest: 9360,
      total: 789360,
    });
  });

  it('celebrates, shows the money moving and what happens next', () => {
    renderStep();
    expect(screen.getByRole('header', { name: 'You did it!' })).toBeTruthy();
    expect(
      screen.getByText('Your iPhone 15 is fully saved.')
    ).toBeOnTheScreen();
    expect(screen.getByText('Interest earned')).toBeOnTheScreen();
    expect(screen.getByText('₦789,360')).toBeOnTheScreen();
    expect(
      screen.getByText('Our team contacts you to finish your order')
    ).toBeOnTheScreen();
  });

  it('does not call a matured, underfunded plan fully saved', () => {
    const handlers = {
      onDone: jest.fn(),
      onNotNow: jest.fn(),
      onSignIn: jest.fn(),
    };
    render(
      <GoalCompleteStep
        colors={Colors.light}
        flow={makeFlow()}
        goal={{ ...goal, current_amount: 500000, principal_amount: 500000 }}
        {...handlers}
      />
    );
    expect(
      screen.getByRole('header', { name: 'Your plan is ready' })
    ).toBeTruthy();
    expect(
      screen.getByText('Your iPhone 15 plan has reached its end date.')
    ).toBeOnTheScreen();
    expect(screen.queryByText(/fully saved/)).toBeNull();
  });

  it('starts the PIN-protected complete, or steps back with Not now', () => {
    const flow = makeFlow();
    const handlers = {
      onDone: jest.fn(),
      onNotNow: jest.fn(),
      onSignIn: jest.fn(),
    };
    render(
      <GoalCompleteStep
        colors={Colors.light}
        flow={flow}
        goal={goal}
        {...handlers}
      />
    );
    fireEvent.press(
      screen.getByRole('button', { name: 'Complete and request my phone' })
    );
    expect(flow.begin).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    expect(handlers.onNotNow).toHaveBeenCalledTimes(1);
  });

  it('confirms the request and closes on Done', () => {
    const handlers = renderStep(makeFlow('done'));
    expect(screen.getByRole('header', { name: 'Request sent' })).toBeTruthy();
    expect(screen.getByText(/₦789,360 is in your wallet/)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
  });

  it('hides the buttons while it is completing', () => {
    renderStep(makeFlow('submitting'));
    expect(
      screen.queryByRole('button', { name: 'Complete and request my phone' })
    ).toBeNull();
    expect(screen.getByText('Completing your goal…')).toBeOnTheScreen();
  });

  it('lets the customer check again after a slow answer', () => {
    const flow = makeFlow('timed_out');
    renderStep(flow);
    fireEvent.press(screen.getByRole('button', { name: 'Check again' }));
    expect(flow.checkAgain).toHaveBeenCalledTimes(1);
  });
});
