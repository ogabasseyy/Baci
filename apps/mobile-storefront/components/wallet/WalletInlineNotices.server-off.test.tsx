import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { useWalletFundPromptStore } from './fund/wallet-fund-prompt-store';
import { useSavingsNoticeStore } from './savings/savings-notice-store';
import { WalletInlineNotices } from './WalletInlineNotices';

jest.mock('@/stores/auth-store', () => {
  const state = { user: null, merchantId: null };
  const useAuthStore = (select: (s: typeof state) => unknown) => select(state);
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

const renderNotices = (savingsSheetOpen = false, fundSheetOpen = false) =>
  render(
    <WalletInlineNotices
      colors={Colors.light}
      fundSheetOpen={fundSheetOpen}
      savingsSheetOpen={savingsSheetOpen}
    />
  );

describe('wallet inline notices with the server keeping PiggyVest off', () => {
  beforeEach(() => {
    useSavingsNoticeStore.setState({ notice: null, goalId: null });
    useWalletFundPromptStore.setState({ prompt: null });
  });

  it('draws nothing on today’s wallet (no notice, no question)', () => {
    renderNotices();
    expect(screen.queryByTestId('savings-notice')).toBeNull();
    expect(screen.queryByTestId('wallet-fund-prompt')).toBeNull();
  });

  it('shows a waiting notice under the hero, but not over the savings sheet', () => {
    act(() => {
      useSavingsNoticeStore.setState({
        notice: { title: 'Money received', tone: 'success', scope: ':' },
      });
    });
    const { rerender } = renderNotices();
    expect(screen.getByText('Money received')).toBeOnTheScreen();

    rerender(
      <WalletInlineNotices
        colors={Colors.light}
        fundSheetOpen={false}
        savingsSheetOpen
      />
    );
    expect(screen.queryByText('Money received')).toBeNull();
  });
});
