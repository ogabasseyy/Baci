import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { GoalCancelStep } from './GoalCancelStep';
import type { GoalLifecycleStep } from './use-goal-lifecycle';

const baseGoal: WalletActiveSavingsGoal = {
  contribution_amount: 5000,
  contribution_frequency: 'weekly',
  current_amount: 0,
  id: 'goal-1',
  maturity_date: '2027-03-16',
  source_mode: 'manual',
  status: 'active',
  target_amount: 250000,
  title: 'iPhone 15 Pro',
};

type Flow = Parameters<typeof GoalCancelStep>[0]['flow'];

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

function renderStep(
  goal: WalletActiveSavingsGoal,
  flow = makeFlow(),
  handlers = { onDone: jest.fn(), onKeep: jest.fn(), onSignIn: jest.fn() }
) {
  render(
    <GoalCancelStep
      colors={Colors.light}
      flow={flow}
      goal={goal}
      {...handlers}
    />
  );
  return handlers;
}

describe('Cancel goal step inside the savings sheet', () => {
  it('says no money moves when nothing is saved', () => {
    renderStep(baseGoal);
    expect(screen.getByText('Cancel iPhone 15 Pro?')).toBeOnTheScreen();
    expect(screen.getByText(/so no money moves/)).toBeOnTheScreen();
    expect(screen.queryByText('Back to your wallet')).toBeNull();
  });

  it('shows the savings coming back and the interest that is lost', () => {
    renderStep({
      ...baseGoal,
      current_amount: 121240,
      principal_amount: 120000,
    });
    expect(screen.getByText(/lose the interest/)).toBeOnTheScreen();
    expect(screen.getByText('Interest (not refunded)')).toBeOnTheScreen();
    expect(screen.getByText('Back to your wallet')).toBeOnTheScreen();
    expect(screen.getAllByText('₦120,000')).toHaveLength(2);
  });

  it('never implies a full refund when the savings/interest split is unknown', () => {
    renderStep({ ...baseGoal, current_amount: 50000 });
    expect(screen.queryByText('Back to your wallet')).toBeNull();
    expect(
      screen.getByText(/Any interest on this goal is not refunded/)
    ).toBeOnTheScreen();
  });

  it('does not promise an empty goal will close', () => {
    renderStep(baseGoal);
    expect(screen.queryByText(/just closes/)).toBeNull();
  });

  it('starts the PIN-protected cancel, or goes back on Keep saving', () => {
    const flow = makeFlow();
    const handlers = renderStep(baseGoal, flow);
    fireEvent.press(screen.getByRole('button', { name: 'Cancel goal' }));
    expect(flow.begin).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: 'Keep saving' }));
    expect(handlers.onKeep).toHaveBeenCalledTimes(1);
  });

  it('hides the buttons while the cancel is in progress', () => {
    renderStep(baseGoal, makeFlow('submitting'));
    expect(screen.queryByRole('button', { name: 'Cancel goal' })).toBeNull();
    expect(screen.getByText('Cancelling your goal…')).toBeOnTheScreen();
  });

  it('confirms and closes when done', () => {
    const handlers = renderStep(
      { ...baseGoal, current_amount: 5000 },
      makeFlow('done')
    );
    expect(screen.getByText('Goal cancelled')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(handlers.onDone).toHaveBeenCalledTimes(1);
  });

  it('offers PIN again after the PIN step was closed', () => {
    const flow = makeFlow('pin_cancelled');
    renderStep(baseGoal, flow);
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(flow.retryPin).toHaveBeenCalledTimes(1);
  });

  it('shows the server message and only a way back when it is final', () => {
    renderStep(
      baseGoal,
      makeFlow('failed', { message: 'This goal can’t be cancelled.' })
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This goal can’t be cancelled.'
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Keep saving' })
    ).toBeOnTheScreen();
  });
});
