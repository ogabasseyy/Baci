import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import { useWallet } from '@/hooks/use-wallet';
import { issueGoalAction } from '@/lib/goal-lifecycle-api';
import { useAuthStore } from '@/stores/auth-store';
import { GoalLifecycleScreen } from './GoalLifecycleScreen';
import { type GoalLifecycleStep, useGoalLifecycle } from './use-goal-lifecycle';
import { usePrimaryGoalGate } from './use-primary-goal-gate';

let mockStep: GoalLifecycleStep = 'review';
const mockBegin = jest.fn(async () => undefined);
const mockRetryPin = jest.fn(async () => undefined);
const mockCheckAgain = jest.fn(async () => undefined);

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
jest.mock('./use-goal-lifecycle', () => ({
  ...jest.requireActual('./use-goal-lifecycle'),
  useGoalLifecycle: jest.fn(),
}));
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

function renderScreen(children?: ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      {children ?? <GoalLifecycleScreen kind="cancel" goalId={GOAL} />}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  mockStep = 'review';
  jest.mocked(useGoalLifecycle).mockImplementation(() => ({
    step: mockStep,
    message: null,
    canStartAgain: mockStep === 'failed',
    needsSignIn: false,
    begin: mockBegin,
    retryPin: mockRetryPin,
    checkAgain: mockCheckAgain,
    sheetProps: { request: null, onProof: jest.fn(), onCancel: jest.fn() },
  }));
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

describe('readiness gate recovery', () => {
  it.each([
    'checking',
  ] as const)('keeps Continue disabled while the gate is %s', (gate) => {
    jest.mocked(usePrimaryGoalGate).mockReturnValue(gate);
    renderScreen();
    expect(screen.queryByText(/Redirect:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Checking…' });
    expect(button).toBeDisabled();
    expect(button).toBeBusy();
    fireEvent.press(button);
    expect(issueGoalAction).not.toHaveBeenCalled();
  });

  it.each([
    'review',
    'pin_cancelled',
    'failed',
    'needs_review',
  ] as const)('retries a failed readiness check from %s without starting a money action', (step) => {
    mockStep = step;
    jest
      .mocked(usePrimaryGoalGate)
      .mockImplementation((_key, retryNonce) =>
        retryNonce ? 'checking' : 'error'
      );
    renderScreen();
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toBeEnabled();
    fireEvent.press(retry);
    expect(usePrimaryGoalGate).toHaveBeenLastCalledWith(undefined, 1);
    for (const button of screen.getAllByRole('button')) {
      if (
        ['Continue', 'Try again', 'Start again', 'Checking…'].includes(
          button.props.accessibilityLabel
        )
      ) {
        expect(button).toBeDisabled();
      }
    }
    expect(issueGoalAction).not.toHaveBeenCalled();
    expect(mockBegin).not.toHaveBeenCalled();
    expect(mockRetryPin).not.toHaveBeenCalled();
    expect(mockCheckAgain).not.toHaveBeenCalled();
  });

  it('enables Continue after the gate becomes ready', () => {
    jest.mocked(usePrimaryGoalGate).mockReturnValue('ready');
    renderScreen();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});
