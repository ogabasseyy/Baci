import { render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsPlanStatusNote } from './SavingsPlanStatusNote';

const mockHook = jest.fn();
const mockIsPrimary = jest.fn();
jest.mock('./use-savings-plan-funding', () => ({
  useSavingsPlanFunding: (...args: unknown[]) => mockHook(...args),
}));
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: (id?: string) => mockIsPrimary(id),
}));

const renderNote = () =>
  render(
    <SavingsPlanStatusNote
      colors={Colors.light}
      goalId="goal-1"
      identityKey="user-1"
      merchantId="merchant-1"
    />
  );

describe('SavingsPlanStatusNote', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPrimary.mockReturnValue(true);
    mockHook.mockReturnValue({
      planFundingPhase: 'pending',
      planFundingRequiresBvn: false,
    });
  });

  it('asks the user to check back and offers no setup action', () => {
    renderNote();
    expect(
      screen.getByText(
        'This goal is still being set up. Please check back shortly.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/\d{10}/)).toBeNull();
  });

  it('only reads status for the goal, never provisions', () => {
    renderNote();
    expect(mockHook).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal-1', loadExisting: true })
    );
    const result = mockHook.mock.results[0]?.value as Record<string, unknown>;
    expect(result.fetchPlanFunding).toBeUndefined();
  });

  it('renders nothing once the goal is ready', () => {
    mockHook.mockReturnValue({
      planFundingPhase: 'ready',
      planFundingRequiresBvn: false,
    });
    expect(renderNote().toJSON()).toBeNull();
  });

  it('renders nothing and reads nothing for legacy merchants', () => {
    mockIsPrimary.mockReturnValue(false);
    expect(renderNote().toJSON()).toBeNull();
    expect(mockHook).toHaveBeenCalledWith(
      expect.objectContaining({ loadExisting: false })
    );
  });
});
