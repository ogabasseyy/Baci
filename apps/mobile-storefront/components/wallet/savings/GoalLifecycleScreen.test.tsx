import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import { useWallet } from '@/hooks/use-wallet';
import {
  checkGoalActionStatus,
  issueGoalAction,
  submitGoalAction,
} from '@/lib/goal-lifecycle-api';
import { useAuthStore } from '@/stores/auth-store';
import { GoalLifecycleScreen } from './GoalLifecycleScreen';
import { usePrimaryGoalGate } from './use-primary-goal-gate';

jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{`Redirect:${href}`}</Text>;
  },
  Stack: { Screen: () => null },
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  usePathname: () => '/wallet/savings/goal-actions',
}));
jest.mock('@/hooks/use-wallet', () => ({
  useWallet: jest.fn(),
  walletKeys: { all: ['wallet'] },
}));
jest.mock('@/hooks/use-auth-guard');
jest.mock('@/lib/goal-lifecycle-api');
jest.mock('./use-primary-goal-gate');
// The sheet itself is covered by its own tests: here it only hands back a proof.
jest.mock('./WalletPinSheet', () => ({
  WalletPinSheet: ({
    request,
    onProof,
    onCancel,
  }: {
    request: { action?: string } | null;
    onProof: (proof: string) => void;
    onCancel: () => void;
  }) => {
    const { Pressable, Text } = jest.requireActual('react-native');
    return request ? (
      <>
        <Text>{`PIN for ${request.action}`}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Enter PIN"
          onPress={() => onProof('d'.repeat(64))}
        >
          <Text>Enter PIN</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close PIN"
          onPress={onCancel}
        >
          <Text>Close PIN</Text>
        </Pressable>
      </>
    ) : null;
  },
}));

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const GOAL = '22222222-2222-4222-8222-222222222222';
const OP = '33333333-3333-4333-8333-333333333333';
const goal = {
  id: GOAL,
  title: 'iPhone 15',
  current_amount: 125000,
  target_amount: 500000,
  status: 'active',
};

function wrap(children: ReactNode) {
  const client = new QueryClient();
  jest.spyOn(client, 'invalidateQueries');
  return {
    client,
    ui: <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  };
}
function renderScreen(kind: 'cancel' | 'complete' = 'cancel') {
  const { client, ui } = wrap(
    <GoalLifecycleScreen kind={kind} goalId={GOAL} />
  );
  render(ui);
  return client;
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useRequireAuth).mockReturnValue({
    isAuthenticated: true,
    isLoading: false,
    redirectTo: null,
    user: { id: 'user-a' },
  } as never);
  jest.mocked(usePrimaryGoalGate).mockReturnValue('ready');
  jest.mocked(useWallet).mockReturnValue({
    data: { wallet: { savings_goals: [goal] }, transactions: [] },
    isLoading: false,
  } as never);
  act(() => {
    useAuthStore.setState({
      user: { id: 'user-a' } as never,
      merchantId: MERCHANT,
    });
  });
});

describe.each([
  [
    'cancel',
    'Cancel this goal?',
    'Keep goal',
    'Goal cancelled',
    'The money you saved is back in your main wallet. Any interest this goal earned was not refunded.',
  ],
  [
    'complete',
    'Complete this goal',
    'Not now',
    'Goal completed',
    'Your money is in your main wallet and your purchase request has been sent.',
  ],
] as const)('%s', (kind, reviewTitle, secondary, doneTitle, doneBody) => {
  it('reviews, takes the PIN, submits and confirms', async () => {
    jest
      .mocked(issueGoalAction)
      .mockResolvedValue({ status: 'issued', operationId: OP });
    jest
      .mocked(submitGoalAction)
      .mockResolvedValue({ status: 'confirmed', operationId: OP });
    const client = renderScreen(kind);
    expect(screen.getByText(reviewTitle)).toBeOnTheScreen();
    expect(screen.getByText('iPhone 15')).toBeOnTheScreen();
    expect(screen.getByText(/Saved so far: .*125,000/)).toBeOnTheScreen();
    expect(screen.queryByText(/You will receive/)).toBeNull();
    expect(screen.getByRole('button', { name: secondary })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(`PIN for ${kind}`)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Enter PIN' }));
    expect(await screen.findByText(doneTitle)).toBeOnTheScreen();
    expect(screen.getByText(doneBody)).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Back to wallet' }));
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['wallet'],
    });
    expect(router.replace).toHaveBeenCalledWith('/wallet');
  });
});

it('the secondary button leaves without sending anything', () => {
  renderScreen('cancel');
  fireEvent.press(screen.getByRole('button', { name: 'Keep goal' }));
  expect(router.replace).toHaveBeenCalledWith('/wallet');
  expect(issueGoalAction).not.toHaveBeenCalled();
});

it('a closed PIN sheet says nothing changed and offers Try again; nothing is submitted', async () => {
  jest
    .mocked(issueGoalAction)
    .mockResolvedValue({ status: 'issued', operationId: OP });
  renderScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('PIN for cancel');
  fireEvent.press(screen.getByRole('button', { name: 'Close PIN' }));
  expect(
    await screen.findByText('PIN cancelled. Nothing was changed.')
  ).toBeOnTheScreen();
  expect(submitGoalAction).not.toHaveBeenCalled();
  jest
    .mocked(submitGoalAction)
    .mockResolvedValue({ status: 'confirmed', operationId: OP });
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('PIN for cancel');
  fireEvent.press(screen.getByRole('button', { name: 'Enter PIN' }));
  expect(await screen.findByText('Goal cancelled')).toBeOnTheScreen();
  expect(issueGoalAction).toHaveBeenCalledTimes(1);
});

it('shows a server refusal verbatim in an alert', async () => {
  jest
    .mocked(issueGoalAction)
    .mockRejectedValue(
      Object.assign(
        new Error(
          'This goal can be completed once it reaches its target or its end date.'
        ),
        { code: 'COMPLETE_NOT_ELIGIBLE' }
      )
    );
  renderScreen('complete');
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(
    'This goal can be completed once it reaches its target or its end date.'
  );
  expect(screen.queryByRole('button', { name: 'Start again' })).toBeNull();
});

it('keeps read-only Check again available after a gate error', async () => {
  jest.useFakeTimers();
  jest
    .mocked(issueGoalAction)
    .mockResolvedValue({ status: 'issued', operationId: OP });
  jest
    .mocked(submitGoalAction)
    .mockRejectedValue(
      Object.assign(new Error('x'), { code: 'CANCEL_UNAVAILABLE' })
    );
  jest
    .mocked(checkGoalActionStatus)
    .mockResolvedValue({ status: 'pending', operationId: OP });
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <GoalLifecycleScreen kind="cancel" goalId={GOAL} />
    </QueryClientProvider>
  );
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('PIN for cancel');
  fireEvent.press(screen.getByRole('button', { name: 'Enter PIN' }));
  expect(
    await screen.findByText(
      'We are still processing this. You can safely leave this screen.'
    )
  ).toBeOnTheScreen();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(120_000);
  });
  expect(screen.getByText('Still processing')).toBeOnTheScreen();
  jest.mocked(usePrimaryGoalGate).mockReturnValue('error');
  view.rerender(
    <QueryClientProvider client={client}>
      <GoalLifecycleScreen kind="cancel" goalId={GOAL} />
    </QueryClientProvider>
  );
  const checkAgain = screen.getByRole('button', { name: 'Check again' });
  expect(checkAgain).toBeEnabled();
  jest.mocked(checkGoalActionStatus).mockClear();
  fireEvent.press(checkAgain);
  await waitFor(() => expect(checkGoalActionStatus).toHaveBeenCalledTimes(1));
  expect(submitGoalAction).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

it('needs-review shows the server message with no way to retry', async () => {
  jest
    .mocked(issueGoalAction)
    .mockRejectedValue(
      Object.assign(
        new Error(
          "Your savings are safe. Please don't try again while we check."
        ),
        { code: 'GOAL_NEEDS_REVIEW' }
      )
    );
  renderScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "Your savings are safe. Please don't try again while we check."
  );
  expect(screen.queryByRole('button', { name: 'Start again' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
});

it('Start again re-issues after an expiry', async () => {
  jest
    .mocked(issueGoalAction)
    .mockResolvedValue({ status: 'issued', operationId: OP });
  jest
    .mocked(submitGoalAction)
    .mockRejectedValueOnce(
      Object.assign(new Error('Expired.'), { code: 'CANCEL_EXPIRED' })
    );
  renderScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('PIN for cancel');
  fireEvent.press(screen.getByRole('button', { name: 'Enter PIN' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Start again' }));
  await waitFor(() => expect(issueGoalAction).toHaveBeenCalledTimes(2));
});
