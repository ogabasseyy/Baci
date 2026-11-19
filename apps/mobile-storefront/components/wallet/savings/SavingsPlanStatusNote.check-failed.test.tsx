import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  rememberGoalSetupPhase,
  resetGoalSetupMemory,
} from './goal-setup-memory';
import { SavingsPlanStatusNote } from './SavingsPlanStatusNote';
import type { useSavingsPlanFunding } from './use-savings-plan-funding';

type PlanFunding = ReturnType<typeof useSavingsPlanFunding>;

const mockSlowdown = jest.fn();
jest.mock('@/hooks/use-piggyvest-slowdown', () => ({
  usePiggyvestSlowdown: () => mockSlowdown(),
  useReportPiggyvestSlow: jest.fn(),
}));
jest.mock('./use-savings-goal-setup', () => ({
  useSavingsGoalSetup: () => ({
    choice: null,
    setChoice: jest.fn(),
    submitting: false,
    attempted: false,
    retried: false,
    error: null,
    submit: jest.fn(),
    retry: jest.fn(),
  }),
}));
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: () => true,
}));

const scopeKey = JSON.stringify(['user-1', 'merchant-1', 'goal-1']);
const failedRead: PlanFunding = {
  failExistingPlanFunding: jest.fn(),
  fetchExistingPlanFunding: jest.fn(),
  fetchPlanFunding: jest.fn(),
  fundingError: null,
  planFundingPhase: 'error',
  planFundingRequiresBvn: false,
  planFundingStatusCode: null,
};

const renderSheetNote = (slow: boolean) =>
  render(
    <SavingsPlanStatusNote
      colors={Colors.light}
      goalId="goal-1"
      identityKey="user-1"
      merchantId="merchant-1"
      funding={failedRead}
      slow={slow}
      onCheckAgain={jest.fn().mockResolvedValue(undefined)}
    />
  );

beforeEach(() => {
  jest.clearAllMocks();
  resetGoalSetupMemory();
  mockSlowdown.mockReturnValue(true);
});

describe('bugfix: a failed status read told a ready plan it was still getting ready', () => {
  it.each([
    false,
    true,
  ])('says it cannot check (not "getting ready") when nothing says the plan was waiting (slow=%s)', (slow) => {
    // Arrange: server unreachable on a cold launch, the slowdown notice is up,
    // and this app never saw the plan waiting on setup.
    // Act
    renderSheetNote(slow);

    // Assert
    expect(screen.queryByText('Getting your plan ready')).toBeNull();
    expect(
      screen.getByText(
        'We couldn’t check on your plan just now. Check your connection and try again.'
      )
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('says it cannot check when the plan was last seen ready', () => {
    rememberGoalSetupPhase(scopeKey, 'ready');

    renderSheetNote(true);

    expect(screen.queryByText('Getting your plan ready')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeOnTheScreen();
  });

  it('keeps the calm card when the plan was last seen getting ready', () => {
    rememberGoalSetupPhase(scopeKey, 'pending');

    renderSheetNote(false);

    expect(screen.getByText('Getting your plan ready')).toBeOnTheScreen();
    expect(screen.queryByText(/couldn’t check on your plan/)).toBeNull();
  });

  it('keeps the calm card while its own checks run past the first minute on a plan last seen getting ready', () => {
    // Moved from the note's main tests: still checking, the last quick reads failed.
    mockSlowdown.mockReturnValue(false);
    rememberGoalSetupPhase(scopeKey, 'pending');

    renderSheetNote(true);

    expect(screen.getByText('Getting your plan ready')).toBeOnTheScreen();
    expect(screen.queryByText(/couldn’t check on your plan/)).toBeNull();
  });
});
