import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { askWalletFund } from './ask-wallet-fund';
import { WalletFundPromptCard } from './WalletFundPromptCard';
import { useWalletFundPromptStore } from './wallet-fund-prompt-store';

let mockAuth = { user: { id: 'customer-1' }, merchantId: 'store-1' };
jest.mock('@/stores/auth-store', () => {
  const useAuthStore = (select: (state: typeof mockAuth) => unknown) =>
    select(mockAuth);
  useAuthStore.getState = () => mockAuth;
  return { useAuthStore };
});

describe('inline funding question with the server keeping PiggyVest off', () => {
  beforeEach(() => {
    mockAuth = { user: { id: 'customer-1' }, merchantId: 'store-1' };
    useWalletFundPromptStore.setState({ prompt: null });
  });

  it('draws nothing when no question is waiting (today’s wallet)', () => {
    render(<WalletFundPromptCard colors={Colors.light} />);
    expect(screen.queryByTestId('wallet-fund-prompt')).toBeNull();
  });

  it('answers the rail-check retry with its own button', async () => {
    let answer!: Promise<boolean>;
    act(() => {
      answer = askWalletFund(
        'We couldn’t check your wallet',
        'Nothing was charged. Check your connection, then try again.',
        'Try again'
      );
    });
    render(<WalletFundPromptCard colors={Colors.light} />);

    expect(screen.getByText('We couldn’t check your wallet')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByTestId('wallet-fund-prompt')).toBeNull();
  });

  it('declines with Not now', async () => {
    let answer!: Promise<boolean>;
    act(() => {
      answer = askWalletFund('Resume pending funding', 'Continue?', 'Resume');
    });
    render(<WalletFundPromptCard colors={Colors.light} />);

    fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    await expect(answer).resolves.toBe(false);
  });

  it('never shows another account’s question and declines it', async () => {
    let answer!: Promise<boolean>;
    act(() => {
      answer = askWalletFund('Resume pending funding', 'Continue?', 'Resume');
    });
    mockAuth = { user: { id: 'customer-2' }, merchantId: 'store-1' };
    render(<WalletFundPromptCard colors={Colors.light} />);

    expect(screen.queryByText('Resume pending funding')).toBeNull();
    await expect(answer).resolves.toBe(false);
  });
});
