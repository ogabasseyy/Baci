import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import { useWallet } from '@/hooks/use-wallet';
import { issueGoalAction } from '@/lib/goal-lifecycle-api';
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
jest.mock('./WalletPinSheet', () => ({ WalletPinSheet: () => null }));

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const GOAL = '22222222-2222-4222-8222-222222222222';
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

describe('redirects', () => {
  it.each([
    ['gate off', () => jest.mocked(usePrimaryGoalGate).mockReturnValue('off')],
    [
      'unknown goal',
      () =>
        jest.mocked(useWallet).mockReturnValue({
          data: { wallet: { savings_goals: [] }, transactions: [] },
          isLoading: false,
        } as never),
    ],
  ])('goes to the wallet for %s without any request', (_name, arrange) => {
    arrange();
    renderScreen();
    expect(screen.getByText('Redirect:/wallet')).toBeOnTheScreen();
    expect(issueGoalAction).not.toHaveBeenCalled();
  });

  it('goes to login when signed out', () => {
    jest.mocked(useRequireAuth).mockReturnValue({
      redirectTo: '/auth/login?returnTo=x',
      user: null,
    } as never);
    renderScreen();
    expect(
      screen.getByText('Redirect:/auth/login?returnTo=x')
    ).toBeOnTheScreen();
  });

  it('waits while the gate is checking', () => {
    jest.mocked(usePrimaryGoalGate).mockReturnValue('checking');
    renderScreen();
    expect(screen.queryByText(/Redirect:/)).toBeNull();
  });
});

describe('the readiness gate is still checking', () => {
  beforeEach(() => {
    jest.mocked(usePrimaryGoalGate).mockReturnValue('checking');
  });

  it('keeps Continue disabled, labelled as checking, and sends nothing', () => {
    renderScreen();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Checking…' });
    expect(button).toBeDisabled();
    expect(button).toBeBusy();
    fireEvent.press(button);
    expect(issueGoalAction).not.toHaveBeenCalled();
  });

  it('enables Continue once the gate is ready', () => {
    jest.mocked(usePrimaryGoalGate).mockReturnValue('ready');
    renderScreen();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});

describe('a sign-in refusal', () => {
  it('offers to sign in, with a way back to this screen', async () => {
    jest.mocked(issueGoalAction).mockRejectedValue(
      Object.assign(new Error('Please sign in again.'), {
        code: 'UNAUTHORIZED',
      })
    );
    renderScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please sign in again.'
    );
    expect(screen.queryByRole('button', { name: 'Start again' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    const target = jest.mocked(router.replace).mock.calls[0][0] as string;
    const returnTo = decodeURIComponent(target.split('returnTo=')[1]);
    expect(target.startsWith('/auth/login?returnTo=')).toBe(true);
    // The way back keeps the goal and action so the route does not bounce to /wallet.
    expect(returnTo).toBe(
      `/wallet/savings/goal-actions?goalId=${GOAL}&kind=cancel`
    );
  });

  it('shows no sign-in button for another refusal', async () => {
    jest
      .mocked(issueGoalAction)
      .mockRejectedValue(
        Object.assign(new Error('Not ready.'), { code: 'SAVINGS_NOT_READY' })
      );
    renderScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });
});

describe('a goal that vanishes from a later wallet refresh', () => {
  it('keeps showing the last seen goal instead of redirecting', () => {
    const { ui } = wrap(<GoalLifecycleScreen kind="cancel" goalId={GOAL} />);
    const view = render(ui);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    jest.mocked(useWallet).mockReturnValue({
      data: { wallet: { savings_goals: [] }, transactions: [] },
      isLoading: false,
    } as never);
    view.rerender(ui);
    expect(screen.queryByText('Redirect:/wallet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('does not show a retained goal for a different goal id', () => {
    const { ui } = wrap(<GoalLifecycleScreen kind="cancel" goalId={GOAL} />);
    const view = render(ui);
    jest.mocked(useWallet).mockReturnValue({
      data: { wallet: { savings_goals: [] }, transactions: [] },
      isLoading: false,
    } as never);
    const other = wrap(
      <GoalLifecycleScreen
        kind="cancel"
        goalId="33333333-3333-4333-8333-333333333333"
      />
    );
    view.rerender(other.ui);
    expect(screen.getByText('Redirect:/wallet')).toBeOnTheScreen();
  });
});

describe('the goal is not on screen yet', () => {
  it('keeps Continue disabled and sends nothing while the wallet has not loaded', () => {
    jest
      .mocked(useWallet)
      .mockReturnValue({ data: undefined, isLoading: true } as never);
    renderScreen();
    const button = screen.getByRole('button', { name: 'Checking…' });
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(issueGoalAction).not.toHaveBeenCalled();
  });
});

describe('a retained goal after an account switch', () => {
  it('is dropped for another user instead of showing the last customer goal', () => {
    const { ui } = wrap(<GoalLifecycleScreen kind="cancel" goalId={GOAL} />);
    const view = render(ui);
    expect(screen.getByText('iPhone 15')).toBeOnTheScreen();
    jest.mocked(useWallet).mockReturnValue({
      data: { wallet: { savings_goals: [] }, transactions: [] },
      isLoading: false,
    } as never);
    act(() => {
      useAuthStore.setState({ user: { id: 'user-b' } as never });
    });
    view.rerender(ui);
    expect(screen.queryByText('iPhone 15')).toBeNull();
  });
});
