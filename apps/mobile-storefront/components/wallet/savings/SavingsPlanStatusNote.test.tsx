import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsPlanStatusNote } from './SavingsPlanStatusNote';

const mockHook = jest.fn();
const mockSetup = jest.fn();
jest.mock('./use-savings-goal-setup', () => ({
  useSavingsGoalSetup: (...args: unknown[]) => mockSetup(...args),
}));
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
    mockSetup.mockReturnValue({
      choice: null,
      setChoice: jest.fn(),
      submitting: false,
      attempted: false,
      error: null,
      submit: jest.fn(),
    });
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
      expect.objectContaining({
        goalId: 'goal-1',
        loadExisting: true,
        notFoundMeansNotStarted: true,
      })
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

  it.each([
    'idle',
    'loading',
  ])('renders nothing while %s', (planFundingPhase) => {
    mockHook.mockReturnValue({
      planFundingPhase,
      planFundingRequiresBvn: false,
    });
    expect(renderNote().toJSON()).toBeNull();
  });

  it('renders nothing while the capability verdict is missing', () => {
    mockHook.mockReturnValue({
      planFundingPhase: 'pending',
      planFundingRequiresBvn: true,
    });
    expect(renderNote().toJSON()).toBeNull();
  });

  it('says setup is unavailable when the server cannot set the goal up', () => {
    mockHook.mockReturnValue({
      planFundingPhase: 'unavailable',
      planFundingRequiresBvn: false,
    });
    renderNote();
    expect(
      screen.getByText('Setup is not available for this goal right now.')
    ).toBeTruthy();
    expect(screen.queryByText(/still being set up/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers a status-only retry when the lookup failed', () => {
    const fetchExistingPlanFunding = jest.fn();
    const fetchPlanFunding = jest.fn();
    mockHook.mockReturnValue({
      fetchExistingPlanFunding,
      fetchPlanFunding,
      planFundingPhase: 'error',
      planFundingRequiresBvn: false,
    });
    renderNote();
    expect(
      screen.getByText("We couldn't check this goal's status.")
    ).toBeTruthy();
    expect(screen.queryByText(/still being set up/)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(fetchExistingPlanFunding).toHaveBeenCalledTimes(1);
    expect(fetchPlanFunding).not.toHaveBeenCalled();
  });

  it('shows the setup copy and no retry for a never-started goal', () => {
    mockHook.mockReturnValue({
      planFundingPhase: 'pending',
      planFundingRequiresBvn: false,
      fundingError: null,
    });
    renderNote();
    expect(screen.getByText(/still being set up/)).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('shows the status when the parent supplies it, even while the capability probe leaves BVN required', () => {
    render(
      <SavingsPlanStatusNote
        colors={Colors.light}
        goalId="goal-1"
        identityKey="user-1"
        merchantId="merchant-1"
        funding={
          {
            planFundingPhase: 'pending',
            planFundingRequiresBvn: true,
          } as never
        }
      />
    );
    expect(
      screen.getByText(
        'This goal is still being set up. Please check back shortly.'
      )
    ).toBeOnTheScreen();
  });
});
