import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import {
  fetchExistingSavingsPlanFunding,
  setupExistingSavingsGoal,
} from '@/lib/customer-savings';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import {
  expectNoPiggyvestUi,
  SERVER_OFF_GOAL_ID,
  SERVER_OFF_MERCHANT_ID,
} from '@/test-support/piggyvest-server-off.test-support';
import { SavingsGoalSetupPrompt } from './SavingsGoalSetupPrompt';
import { SavingsPlanStatusNote } from './SavingsPlanStatusNote';

jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: jest.fn(),
  fetchSavingsPlanFunding: jest.fn(),
  setupExistingSavingsGoal: jest.fn(),
}));
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: jest.fn(),
}));

// The pilot merchant would read status; the verdict alone must keep the
// prompt away while the server keeps PiggyVest off.
const PILOT_MERCHANT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const notStarted = () =>
  Object.assign(new Error('not found'), { code: 'SAVINGS_WALLET_NOT_FOUND' });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchExistingSavingsPlanFunding).mockRejectedValue(notStarted());
});

describe('server keeps PiggyVest off', () => {
  it.each([
    ['no verdict yet', null, SERVER_OFF_MERCHANT_ID],
    ['a negative verdict', false, SERVER_OFF_MERCHANT_ID],
    ['no verdict yet, pilot merchant', null, PILOT_MERCHANT],
    ['a negative verdict, pilot merchant', false, PILOT_MERCHANT],
  ])('never shows the setup prompt with %s', async (_name, verdict, merchantId) => {
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
    expect(setupExistingSavingsGoal).not.toHaveBeenCalled();
  });

  it('is inert on its own: rendering it sends nothing', () => {
    render(
      <SavingsGoalSetupPrompt
        colors={Colors.light}
        choice={null}
        statusReady={false}
        submitting={false}
        error={null}
        onChoose={jest.fn()}
        onSubmit={jest.fn()}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Finish setting up' })
    ).toBeDisabled();
    expect(setupExistingSavingsGoal).not.toHaveBeenCalled();
    expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
  });
});
