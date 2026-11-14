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
const retry = jest.fn().mockResolvedValue(true);
const setChoice = jest.fn();
const setupState = (change: Record<string, unknown> = {}) => ({
  choice: null,
  setChoice,
  submitting: false,
  attempted: false,
  error: null,
  submit,
  retry,
  ...change,
});
const status = (planFundingPhase: string, requiresBvn = false) =>
  mockFunding.mockReturnValue({
    planFundingPhase,
    planFundingRequiresBvn: requiresBvn,
    fetchExistingPlanFunding: refresh,
  });
const noteElement = () => (
  <SavingsPlanStatusNote
    colors={Colors.light}
    goalId="goal-1"
    identityKey="user-1"
    merchantId="merchant-1"
  />
);
const renderNote = () => render(noteElement());
/** The try settles and status is read again, still stalled. */
const rereadStalled = (
  view: ReturnType<typeof renderNote>,
  change: Record<string, unknown> = {}
) => {
  mockSetupHook.mockReturnValue(setupState(change));
  status('loading');
  view.rerender(noteElement());
  status('setup_retryable');
  view.rerender(noteElement());
};
/** Renders a retryable goal and lets both automatic tries finish. */
const renderExhausted = async (change: Record<string, unknown> = {}) => {
  const view = renderNote();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    mockSetupHook.mockReturnValue(setupState({ submitting: true }));
    view.rerender(noteElement());
    rereadStalled(view, change);
    // The automatic try settles.
    await act(async () => {});
  }
  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
  resetAutoSetupRetries();
  resetPlanInterestAnswers();
  retry.mockResolvedValue(true);
  mockSetupHook.mockReturnValue(setupState());
});

describe('existing-goal setup prompt', () => {
  it('asks the interest question, with no answer preselected, once status says not started', () => {
    status('not_started');
    renderNote();
    expect(screen.getByText('Earn interest on this plan?')).toBeTruthy();
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

  it('keeps Finish setting up disabled until the customer has chosen', () => {
    status('not_started');
    renderNote();
    const button = screen.getByRole('button', { name: 'Finish setting up' });
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(submit).not.toHaveBeenCalled();
  });

  it('enables Finish setting up after a choice and submits it', () => {
    status('not_started');
    mockSetupHook.mockReturnValue(setupState({ choice: false }));
    renderNote();
    fireEvent.press(screen.getByRole('button', { name: 'Finish setting up' }));
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
      screen.getByRole('button', { name: 'Finish setting up' })
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
    expect(screen.queryByText('Finish setting up')).toBeNull();
    expect(screen.queryByText('Earn interest on this plan?')).toBeNull();
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

describe('retry of an expired claim', () => {
  it('retries by itself without a new interest question, then shows the getting-ready card while a try runs', () => {
    status('setup_retryable');
    mockSetupHook.mockReturnValue(setupState({ submitting: true }));
    renderNote();
    expect(screen.getByText('Getting your plan ready')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText('Earn interest on this plan?')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('auto-retries twice through the setup hook, never sends a choice, then offers Try again and support', async () => {
    status('setup_retryable');
    const view = renderNote();
    expect(retry).toHaveBeenCalledTimes(1);
    await act(async () => {});
    // A running try ends and status still reads stalled, so the second starts.
    mockSetupHook.mockReturnValue(setupState({ submitting: true }));
    view.rerender(noteElement());
    rereadStalled(view);
    expect(retry).toHaveBeenCalledTimes(2);
    await act(async () => {});
    mockSetupHook.mockReturnValue(setupState({ submitting: true }));
    view.rerender(noteElement());
    rereadStalled(view);
    expect(retry).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
    expect(
      screen.getByText('We couldn’t finish setting up your plan')
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Message support' })).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(3);
    expect(submit).not.toHaveBeenCalled();
  });

  it('keeps the action disabled, not hidden, while status is re-read after Try again', async () => {
    status('setup_retryable');
    const view = await renderExhausted();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    status('loading');
    mockSetupHook.mockReturnValue(
      setupState({ attempted: true, retried: true })
    );
    view.rerender(noteElement());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled();
  });

  it('shows a safe error after the automatic tries are used up', async () => {
    status('setup_retryable');
    await renderExhausted({ error: "We couldn't confirm this goal's setup." });
    expect(screen.getByText(/couldn't confirm/)).toBeTruthy();
  });

  it('offers no retry without an available primary verdict', () => {
    status('setup_retryable', true);
    expect(renderNote().toJSON()).toBeNull();
  });

  it('says a live claim is getting ready, with no action', () => {
    status('pending');
    renderNote();
    expect(screen.getByText('Getting your plan ready')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
    expect(retry).not.toHaveBeenCalled();
  });
});

describe('shared status', () => {
  const sharedFunding = (planFundingPhase: string) =>
    ({
      planFundingPhase,
      planFundingRequiresBvn: false,
      fetchExistingPlanFunding: refresh,
    }) as never;
  const renderShared = (phase: string) =>
    render(
      <SavingsPlanStatusNote
        colors={Colors.light}
        goalId="goal-1"
        identityKey="user-1"
        merchantId="merchant-1"
        funding={sharedFunding(phase)}
      />
    );

  it('reads the status it is given and starts no status hook of its own', () => {
    renderShared('pending');
    expect(mockFunding).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'This usually takes about a minute. You can leave this screen. We’ll keep going.'
      )
    ).toBeTruthy();
  });

  it('asks the interest question for a shared not-started status and re-reads it after setup', () => {
    renderShared('not_started');
    expect(screen.getByText('Earn interest on this plan?')).toBeTruthy();
    expect(mockSetupHook).toHaveBeenCalledWith(
      expect.objectContaining({ goalId: 'goal-1', merchantId: 'merchant-1' })
    );
    mockSetupHook.mock.calls[0][0].onSettled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows nothing for a shared ready status', () => {
    renderShared('ready');
    expect(screen.toJSON()).toBeNull();
  });
});

describe('bugfix: auto-retry ran behind the BVN field', () => {
  it('does not retry a stalled setup while the BVN field hides the note', () => {
    status('setup_retryable', true);
    renderNote();
    expect(retry).not.toHaveBeenCalled();
  });

  it('retries a stalled setup by itself once the note is on screen', () => {
    status('setup_retryable');
    renderNote();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('bugfix: the automatic-retry budget was shared across accounts', () => {
  it('gives another account on the same goal id its own tries', async () => {
    status('setup_retryable');
    await renderExhausted({ retry });
    const calls = retry.mock.calls.length;
    render(
      <SavingsPlanStatusNote
        colors={Colors.light}
        goalId="goal-1"
        identityKey="user-2"
        merchantId="merchant-1"
      />
    );
    expect(retry.mock.calls.length).toBe(calls + 1);
  });
});

describe('auto-retry when a parent supplies the status', () => {
  it('still retries by itself: a stale BVN flag shows no BVN field there', () => {
    status('setup_retryable', true);
    render(
      <SavingsPlanStatusNote
        colors={Colors.light}
        goalId="goal-1"
        identityKey="user-1"
        merchantId="merchant-1"
        funding={mockFunding()}
      />
    );
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('bugfix: a plan whose first setup start never landed asked the interest question again', () => {
  it('finishes setup with the form answer and shows the calm card instead', async () => {
    rememberPlanInterestAnswer('goal-1', false);
    status('not_started');
    renderNote();
    await act(async () => {});
    expect(submit).toHaveBeenCalledWith(false);
    expect(setChoice).toHaveBeenCalledWith(false);
    expect(screen.getByText('Getting your plan ready')).toBeOnTheScreen();
    expect(screen.queryByText(/earn interest/i)).toBeNull();
  });

  it('asks as usual, answer preselected, if that submit fails', async () => {
    rememberPlanInterestAnswer('goal-1', true);
    mockSetupHook.mockReturnValue(
      setupState({ choice: true, attempted: true, error: 'failed' })
    );
    status('not_started');
    renderNote();
    await act(async () => {});
    expect(screen.queryByText('Getting your plan ready')).toBeNull();
  });
});

describe('bugfix: the final automatic retry showed "couldn’t finish" while still running', () => {
  it('keeps the calm card while the last automatic retry is in flight', async () => {
    let finishLast: (sent: boolean) => void = () => undefined;
    const tries = jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finishLast = resolve;
          })
      );
    mockSetupHook.mockReturnValue(setupState({ retry: tries }));
    status('setup_retryable');
    const view = renderNote();
    await act(async () => {});
    // The first try ends, so the second (last) one starts and stays running.
    mockSetupHook.mockReturnValue(
      setupState({ retry: tries, submitting: true })
    );
    view.rerender(noteElement());
    rereadStalled(view, { retry: tries });
    await act(async () => {});
    expect(tries).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/couldn’t finish setting up/)).toBeNull();
    expect(screen.getByText('Getting your plan ready')).toBeOnTheScreen();
    // Once it comes back and status still reads stalled, the prompt shows.
    await act(async () => finishLast(true));
    expect(
      screen.getByText('We couldn’t finish setting up your plan')
    ).toBeOnTheScreen();
  });
});
