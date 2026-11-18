import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  rememberPlanInterestAnswer,
  resetPlanInterestAnswers,
} from './plan-interest-answers';
import { SavingsPlanStatusNote } from './SavingsPlanStatusNote';
import { resetAutoSetupRetries } from './use-auto-retry-setup';

jest.mock('./use-goal-wallet-setup-poll', () => ({
  useGoalWalletSetupPoll: () => ({ slow: false, checkAgain: jest.fn() }),
}));
jest.mock('./use-savings-plan-funding', () => ({
  useSavingsPlanFunding: () => ({
    planFundingPhase: 'not_started',
    planFundingRequiresBvn: false,
    fetchExistingPlanFunding: jest.fn(),
  }),
}));
const mockSetupHook = jest.fn();
jest.mock('./use-savings-goal-setup', () => ({
  useSavingsGoalSetup: (...args: unknown[]) => mockSetupHook(...args),
}));
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: () => true,
}));

const submit = jest.fn();
const setChoice = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  resetAutoSetupRetries();
  resetPlanInterestAnswers();
  mockSetupHook.mockReturnValue({
    choice: null,
    setChoice,
    submitting: false,
    attempted: false,
    error: null,
    submit,
    retry: jest.fn().mockResolvedValue(true),
  });
});

describe('bugfix: a saved answer loading late replaced the customer’s choice', () => {
  it('keeps the customer’s picked answer and never auto-submits the saved one', async () => {
    // Arrange: after a restart the answer is only on the device, so it loads late.
    await rememberPlanInterestAnswer('goal-1', true);
    resetPlanInterestAnswers();
    render(
      <SavingsPlanStatusNote
        colors={Colors.light}
        goalId="goal-1"
        identityKey="user-1"
        merchantId="merchant-1"
      />
    );

    // Act: the customer picks No before the saved answer finishes loading.
    fireEvent.press(screen.getByLabelText('No, do not earn interest'));
    await act(async () => {});
    await act(async () => {});

    // Assert: the saved Yes is neither chosen nor sent; the question stays.
    expect(setChoice).toHaveBeenCalledWith(false);
    expect(setChoice).not.toHaveBeenCalledWith(true);
    expect(submit).not.toHaveBeenCalled();
    expect(screen.queryByText('Getting your plan ready')).toBeNull();
  });
});
