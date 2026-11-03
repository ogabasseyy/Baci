import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { PLAN_NOT_SET_UP_MESSAGE } from '@/lib/customer-savings-plan-funding';
import { SavingsPlanSetupAction } from './SavingsPlanSetupAction';

const mockFetchPlanFunding = jest.fn();
const mockFetchExisting = jest.fn();
const mockIsPrimary = jest.fn();
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: (id?: string) => mockIsPrimary(id),
}));
const mockHook = jest.fn();
jest.mock('./use-savings-plan-funding', () => ({
  useSavingsPlanFunding: (...args: unknown[]) => mockHook(...args),
}));

const hookState = (overrides = {}) => ({
  fetchPlanFunding: mockFetchPlanFunding,
  fetchExistingPlanFunding: mockFetchExisting,
  fundingError: null,
  planFundingPhase: 'idle',
  planFundingRequiresBvn: false,
  ...overrides,
});

const renderAction = () =>
  render(
    <SavingsPlanSetupAction
      colors={Colors.light}
      goalId="goal-1"
      identityKey="user-1"
      merchantId="merchant-1"
    />
  );

describe('SavingsPlanSetupAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPrimary.mockReturnValue(true);
    mockHook.mockReturnValue(hookState());
  });

  it('checks readiness for the goal and offers setup when it is not ready', () => {
    renderAction();
    expect(mockHook).toHaveBeenCalledWith(
      expect.objectContaining({
        activeMerchantId: 'merchant-1',
        goalId: 'goal-1',
        identityKey: 'user-1',
        loadExisting: true,
      })
    );
    expect(
      screen.getByRole('button', { name: 'Set up this goal' })
    ).toBeTruthy();
  });

  it('does not read plan funding for legacy merchants', () => {
    mockIsPrimary.mockReturnValue(false);
    renderAction();
    expect(mockHook).toHaveBeenCalledWith(
      expect.objectContaining({ loadExisting: false })
    );
  });

  it('runs the existing provisioning without a BVN or interest when first set up', () => {
    renderAction();
    fireEvent.press(screen.getByRole('button', { name: 'Set up this goal' }));
    expect(mockFetchPlanFunding).toHaveBeenCalledWith('', {
      enableInterestAccrual: false,
    });
  });

  it('shows ready state with no action and no account number', () => {
    mockHook.mockReturnValue(hookState({ planFundingPhase: 'ready' }));
    renderAction();
    expect(screen.getByText(/ready to fund/i)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Set up this goal' })
    ).toBeNull();
    expect(screen.queryByText(/\d{10}/)).toBeNull();
  });

  it('disables the action while setting up', () => {
    mockHook.mockReturnValue(hookState({ planFundingPhase: 'loading' }));
    renderAction();
    const button = screen.getByRole('button', { name: /setting up/i });
    fireEvent.press(button);
    expect(mockFetchPlanFunding).not.toHaveBeenCalled();
  });

  it('re-reads status, never re-provisions, while the goal is pending', () => {
    mockHook.mockReturnValue(hookState({ planFundingPhase: 'pending' }));
    renderAction();
    expect(screen.getByText(/still being set up/i)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Check again' }));
    expect(mockFetchExisting).toHaveBeenCalledTimes(1);
    expect(mockFetchPlanFunding).not.toHaveBeenCalled();
  });

  it('offers setup when the status read reports nothing was set up', () => {
    mockHook.mockReturnValue(
      hookState({
        planFundingPhase: 'error',
        fundingError: PLAN_NOT_SET_UP_MESSAGE,
      })
    );
    renderAction();
    fireEvent.press(screen.getByRole('button', { name: 'Set up this goal' }));
    expect(mockFetchPlanFunding).toHaveBeenCalledTimes(1);
  });

  it('shows another error and re-reads status instead of provisioning', () => {
    mockHook.mockReturnValue(
      hookState({ planFundingPhase: 'error', fundingError: 'Try later' })
    );
    renderAction();
    expect(screen.getByText('Try later')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Check again' }));
    expect(mockFetchExisting).toHaveBeenCalledTimes(1);
    expect(mockFetchPlanFunding).not.toHaveBeenCalled();
  });

  it('renders nothing when this goal needs a BVN (legacy setup lives in the creation flow)', () => {
    mockHook.mockReturnValue(hookState({ planFundingRequiresBvn: true }));
    const { toJSON } = renderAction();
    expect(toJSON()).toBeNull();
  });
});
