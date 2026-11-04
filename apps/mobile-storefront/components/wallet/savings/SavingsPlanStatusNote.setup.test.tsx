import { fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsPlanStatusNote } from './SavingsPlanStatusNote';

const mockFunding = jest.fn();
const mockSetupHook = jest.fn();
jest.mock('./use-savings-plan-funding', () => ({
  useSavingsPlanFunding: (...args: unknown[]) => mockFunding(...args),
}));
jest.mock('./use-savings-goal-setup', () => ({
  useSavingsGoalSetup: (...args: unknown[]) => mockSetupHook(...args),
}));
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: () => true,
}));

const refresh = jest.fn();
const submit = jest.fn();
const setChoice = jest.fn();
const setupState = (change: Record<string, unknown> = {}) => ({
  choice: null,
  setChoice,
  submitting: false,
  attempted: false,
  error: null,
  submit,
  ...change,
});
const status = (planFundingPhase: string, requiresBvn = false) =>
  mockFunding.mockReturnValue({
    planFundingPhase,
    planFundingRequiresBvn: requiresBvn,
    fetchExistingPlanFunding: refresh,
  });
const renderNote = () =>
  render(
    <SavingsPlanStatusNote
      colors={Colors.light}
      goalId="goal-1"
      identityKey="user-1"
      merchantId="merchant-1"
    />
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockSetupHook.mockReturnValue(setupState());
});

describe('existing-goal setup prompt', () => {
  it('asks the interest question, with no answer preselected, once status says not started', () => {
    status('not_started');
    renderNote();
    expect(screen.getByText('Earn interest on this goal?')).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: 'Yes, earn interest' })
    ).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ checked: false })
    );
    expect(
      screen.getByRole('radio', { name: 'No, do not earn interest' })
    ).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ checked: false })
    );
  });

  it('keeps Set up this goal disabled until the customer has chosen', () => {
    status('not_started');
    renderNote();
    const button = screen.getByRole('button', { name: 'Set up this goal' });
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(submit).not.toHaveBeenCalled();
  });

  it('enables Set up this goal after a choice and submits it', () => {
    status('not_started');
    mockSetupHook.mockReturnValue(setupState({ choice: false }));
    renderNote();
    fireEvent.press(screen.getByRole('button', { name: 'Set up this goal' }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('passes the chosen answer to the setup hook', () => {
    status('not_started');
    renderNote();
    fireEvent.press(screen.getByRole('radio', { name: 'Yes, earn interest' }));
    expect(setChoice).toHaveBeenCalledWith(true);
    fireEvent.press(
      screen.getByRole('radio', { name: 'No, do not earn interest' })
    );
    expect(setChoice).toHaveBeenLastCalledWith(false);
  });

  it('re-reads status once an attempt settles', () => {
    status('not_started');
    renderNote();
    const options = mockSetupHook.mock.calls[0][0] as { onSettled: () => void };
    options.onSettled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the button disabled, not hidden, while status is re-read after an attempt', () => {
    status('loading');
    mockSetupHook.mockReturnValue(
      setupState({ choice: true, attempted: true })
    );
    renderNote();
    expect(
      screen.getByRole('button', { name: 'Set up this goal' })
    ).toBeDisabled();
  });

  it.each([
    'idle',
    'loading',
    'pending',
    'ready',
    'unavailable',
    'error',
  ])('offers no setup while status is %s', (phase) => {
    status(phase);
    renderNote();
    expect(screen.queryByText('Set up this goal')).toBeNull();
    expect(screen.queryByText('Earn interest on this goal?')).toBeNull();
  });

  it('offers no setup without an available primary verdict', () => {
    status('not_started', true);
    expect(renderNote().toJSON()).toBeNull();
  });

  it('shows a safe error and keeps status re-reading after a failed attempt', () => {
    status('not_started');
    mockSetupHook.mockReturnValue(
      setupState({
        choice: true,
        error: "We couldn't confirm this goal's setup.",
      })
    );
    renderNote();
    expect(screen.getByText(/couldn't confirm/)).toBeTruthy();
  });
});
