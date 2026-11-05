import { render } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { fetchExistingSavingsPlanFunding } from '@/lib/customer-savings';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import {
  SERVER_OFF_GOAL_ID,
  SERVER_OFF_MERCHANT_ID,
} from '@/test-support/piggyvest-server-off.test-support';
import { SavingsPlanStatusNote } from './SavingsPlanStatusNote';

jest.mock('@/lib/customer-savings', () => ({
  fetchExistingSavingsPlanFunding: jest.fn(),
  fetchSavingsPlanFunding: jest.fn(),
}));
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  usePiggyvestPrimaryCapability: jest.fn(),
}));

const renderNote = () =>
  render(
    <SavingsPlanStatusNote
      colors={Colors.light}
      goalId={SERVER_OFF_GOAL_ID}
      identityKey="user-a"
      merchantId={SERVER_OFF_MERCHANT_ID}
    />
  );

beforeEach(() => jest.clearAllMocks());

// No verdict, a negative verdict or a failed probe: the note renders nothing
// and never calls the primary status endpoint, like the production build.
describe('server keeps PiggyVest off', () => {
  it.each([
    ['no verdict yet', null],
    ['a negative verdict', false],
  ])('renders nothing and reads nothing with %s', async (_name, verdict) => {
    jest
      .mocked(usePiggyvestPrimaryCapability)
      .mockReturnValue(verdict as never);
    const view = renderNote();
    await Promise.resolve();
    expect(view.toJSON()).toBeNull();
    expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
  });
});

describe('server keeps PiggyVest off (shared status)', () => {
  it('renders nothing for a non-primary merchant even when handed a status', () => {
    const { toJSON } = render(
      <SavingsPlanStatusNote
        colors={Colors.light}
        goalId={SERVER_OFF_GOAL_ID}
        identityKey="user-a"
        merchantId={SERVER_OFF_MERCHANT_ID}
        funding={
          {
            planFundingPhase: 'pending',
            planFundingRequiresBvn: false,
            fetchExistingPlanFunding: jest.fn(),
          } as never
        }
      />
    );
    expect(toJSON()).toBeNull();
    expect(fetchExistingSavingsPlanFunding).not.toHaveBeenCalled();
  });
});
