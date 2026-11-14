import { act, render, screen } from '@testing-library/react-native';
import WalletRoute from '@/app/wallet';
import { notifySavings } from '@/components/wallet/savings/savings-notice';
import { useSavingsNoticeStore } from '@/components/wallet/savings/savings-notice-store';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ savingsGoalId: ['goal-1', 'goal-2'] }),
  useNavigation: () => ({ addListener: () => () => undefined }),
}));
jest.mock('@/components/wallet/WalletScreen', () => ({
  WalletScreen: (props: { savingsGoalId: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{`wallet:${props.savingsGoalId}`}</Text>;
  },
}));

// The route only passes params and owns the note's lifetime: no server call.
describe('server keeps PiggyVest off: wallet route', () => {
  it('passes the first goal id and clears a wallet-only note when left by Back', () => {
    act(() => {
      notifySavings('That savings plan has closed', undefined, 'info');
      const { notice } = useSavingsNoticeStore.getState();
      useSavingsNoticeStore.setState({
        notice: notice ? { ...notice, walletOnly: true } : notice,
      });
    });
    const { unmount } = render(<WalletRoute />);
    expect(screen.getByText('wallet:goal-1')).toBeOnTheScreen();
    expect(useSavingsNoticeStore.getState().notice?.title).toBe(
      'That savings plan has closed'
    );
    unmount();
    expect(useSavingsNoticeStore.getState().notice).toBeNull();
  });
});
