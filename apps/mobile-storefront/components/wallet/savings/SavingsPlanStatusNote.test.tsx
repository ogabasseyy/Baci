import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsPlanStatusNote } from './SavingsPlanStatusNote';
import type { useSavingsPlanFunding } from './use-savings-plan-funding';

type PlanFunding = ReturnType<typeof useSavingsPlanFunding>;
// A complete status object; each test overrides only the fields it cares about.
const fundingFixture = (over: Partial<PlanFunding> = {}): PlanFunding => ({
  failExistingPlanFunding: jest.fn(),
  fetchExistingPlanFunding: jest.fn(),
  fetchPlanFunding: jest.fn(),
  fundingError: null,
  planFundingPhase: 'pending',
  planFundingRequiresBvn: false,
  planFundingStatusCode: null,
  ...over,
});

const mockHook = jest.fn();
const mockSetup = jest.fn();
jest.mock('./use-savings-goal-setup', () => ({
  useSavingsGoalSetup: (...args: unknown[]) => mockSetup(...args),
}));
const mockIsPrimary = jest.fn();
jest.mock('./use-goal-wallet-setup-poll', () => ({
  useGoalWalletSetupPoll: () => ({ slow: false, checkAgain: jest.fn() }),
}));

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

  it('tells the user the plan is getting ready and offers no setup action', () => {
    renderNote();
    expect(
      screen.getByText(
        'This usually takes about a minute. You can leave this screen. We’ll keep going.'
      )
    ).toBeTruthy();
    expect(screen.getByText('Getting your plan ready')).toBeTruthy();
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
      screen.getByText(
        'We can’t finish setting up this plan right now. No money has moved.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('Getting your plan ready')).toBeNull();
    expect(screen.getByRole('link', { name: 'Message support' })).toBeTruthy();
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
      screen.getByText(
        'We couldn’t check on your plan just now. Check your connection and try again.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('Getting your plan ready')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(fetchExistingPlanFunding).toHaveBeenCalledTimes(1);
    expect(fetchPlanFunding).not.toHaveBeenCalled();
  });

  it('shows the getting-ready card and no retry for a pending goal', () => {
    mockHook.mockReturnValue({
      planFundingPhase: 'pending',
      planFundingRequiresBvn: false,
      fundingError: null,
    });
    renderNote();
    expect(screen.getByText('Getting your plan ready')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('shows the status when the parent supplies it, even while the capability probe leaves BVN required', () => {
    render(
      <SavingsPlanStatusNote
        colors={Colors.light}
        goalId="goal-1"
        identityKey="user-1"
        merchantId="merchant-1"
        funding={fundingFixture({ planFundingRequiresBvn: true })}
      />
    );
    expect(
      screen.getByText(
        'This usually takes about a minute. You can leave this screen. We’ll keep going.'
      )
    ).toBeOnTheScreen();
  });
});

describe('slow pending setup', () => {
  it('says it is taking longer and offers Check now, which runs the supplied check', () => {
    const onCheckAgain = jest.fn();
    render(
      <SavingsPlanStatusNote
        colors={Colors.light}
        goalId="goal-1"
        identityKey="user-1"
        merchantId="merchant-1"
        funding={fundingFixture()}
        slow
        onCheckAgain={onCheckAgain}
      />
    );
    expect(screen.getByText(/taking longer than usual/)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Check now' }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
  });

  it('offers no Check now before it is slow', () => {
    render(
      <SavingsPlanStatusNote
        colors={Colors.light}
        goalId="goal-1"
        identityKey="user-1"
        merchantId="merchant-1"
        funding={fundingFixture()}
        onCheckAgain={jest.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
  });
});
