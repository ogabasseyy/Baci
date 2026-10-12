import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { SavingsPlanTransferPanel } from './SavingsPlanTransferPanel';

const mockCopy = jest.fn();
jest.mock('@/hooks/use-copy-to-clipboard', () => ({
  useCopyToClipboard: () => ({ copyToClipboard: mockCopy, feedback: null }),
}));
const account = {
  accountName: 'Customer savings',
  accountNumber: '0000008907',
  bankName: 'FAAS (SANDBOX)',
};

beforeEach(() => jest.clearAllMocks());

it.each([
  'light',
  'dark',
] as const)('shows number, copy action and bank using the %s theme', (theme) => {
  render(
    <SavingsPlanTransferPanel
      account={account}
      colors={Colors[theme]}
      error={null}
      onRefresh={jest.fn()}
      phase="ready"
    />
  );
  expect(screen.getByText(account.bankName)).toBeOnTheScreen();
  expect(
    StyleSheet.flatten(screen.getByText(account.accountNumber).props.style)
  ).toMatchObject({ color: Colors[theme].text });
  expect(screen.queryByText(account.accountName)).toBeNull();
  fireEvent.press(
    screen.getByRole('button', { name: 'Copy savings account number' })
  );
  expect(mockCopy).toHaveBeenCalledWith(account.accountNumber);
  expect(screen.getByText(/Do not send real money/)).toBeOnTheScreen();
});

it.each([
  'idle',
  'loading',
] as const)('shows loading, not a stale account, while %s', (phase) => {
  render(
    <SavingsPlanTransferPanel
      account={account}
      colors={Colors.dark}
      error={null}
      onRefresh={jest.fn()}
      phase={phase}
    />
  );
  expect(screen.getByLabelText('Loading savings account')).toBeOnTheScreen();
  expect(screen.queryByText(account.accountNumber)).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Refresh savings account' })
  ).toBeDisabled();
});

it.each([
  'pending',
  'unavailable',
  'error',
] as const)('offers a safe retry after %s without a placeholder number', async (phase) => {
  const refresh = jest.fn();
  render(
    <SavingsPlanTransferPanel
      colors={Colors.light}
      error={phase === 'error' ? 'Connection unavailable' : null}
      onRefresh={refresh}
      phase={phase}
    />
  );
  expect(
    screen.queryByRole('button', { name: 'Copy savings account number' })
  ).toBeNull();
  await act(async () => {
    fireEvent.press(
      screen.getByRole('button', { name: 'Refresh savings account' })
    );
    await Promise.resolve();
  });
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('does not treat an empty ready response as a usable bank account', () => {
  render(
    <SavingsPlanTransferPanel
      colors={Colors.light}
      error={null}
      onRefresh={jest.fn()}
      phase="ready"
    />
  );
  expect(screen.getByText(/No account is available/)).toBeOnTheScreen();
  expect(
    screen.queryByRole('button', { name: 'Copy savings account number' })
  ).toBeNull();
});

it('ignores rapid repeated refresh taps while a refresh is pending', async () => {
  let finishRefresh: () => void = () => undefined;
  const refresh = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finishRefresh = resolve;
      })
  );
  render(
    <SavingsPlanTransferPanel
      account={account}
      colors={Colors.light}
      error={null}
      onRefresh={refresh}
      phase="ready"
    />
  );
  const button = screen.getByRole('button', {
    name: 'Refresh savings account',
  });

  act(() => {
    fireEvent.press(button);
    fireEvent.press(button);
  });

  expect(refresh).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  await act(async () => {
    finishRefresh();
    await Promise.resolve();
    await Promise.resolve();
  });
});
