import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  fetchExistingSavingsPlanFunding,
  retrySavingsGoalSetup,
} from '@/lib/customer-savings';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import {
  expectNoPiggyvestUi,
  SERVER_OFF_GOAL_ID,
  SERVER_OFF_MERCHANT_ID,
} from '@/test-support/piggyvest-server-off.test-support';
import { SavingsGoalRetryPrompt } from './SavingsGoalRetryPrompt';
import { SavingsPlanStatusNote } from './SavingsPlanStatusNote';

jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: jest.fn(),
  fetchSavingsPlanFunding: jest.fn(),
  setupExistingSavingsGoal: jest.fn(),
  retrySavingsGoalSetup: jest.fn(),
}));
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: jest.fn(),
}));

const PILOT_MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

beforeEach(() => {
  jest.clearAllMocks();
  // Even a server that flags the claim retryable cannot surface the action
  // without an available primary verdict.
  jest
    .mocked(fetchExistingSavingsPlanFunding)
    .mockResolvedValue({ status: 'pending', setupRetryable: true } as never);
});

describe('server keeps PiggyVest off', () => {
  it.each([
    ['no verdict yet', null, SERVER_OFF_MERCHANT_ID],
    ['a negative verdict', false, SERVER_OFF_MERCHANT_ID],
    ['no verdict yet, pilot merchant', null, PILOT_MERCHANT],
    ['a negative verdict, pilot merchant', false, PILOT_MERCHANT],
  ])('never shows the retry action with %s', async (_name, verdict, merchantId) => {
    jest
      .mocked(usePiggyvestPrimaryCapability)
      .mockReturnValue(verdict as never);
    render(
      <SavingsPlanStatusNote
        colors={Colors.light}
        goalId={SERVER_OFF_GOAL_ID}
        identityKey="user-a"
        merchantId={merchantId}
      />
    );
    await Promise.resolve();
    await Promise.resolve();
    expectNoPiggyvestUi();
    expect(retrySavingsGoalSetup).not.toHaveBeenCalled();
  });

  it('is inert on its own: rendering it sends nothing', () => {
    render(
      <SavingsGoalRetryPrompt
        colors={Colors.light}
        submitting={false}
        error={null}
        onRetry={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(retrySavingsGoalSetup).not.toHaveBeenCalled();
    expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
  });
});
