import { act, render, renderHook, screen } from '@testing-library/react-native';
import { useNavigation } from 'expo-router';
import Colors from '@/constants/Colors';
import { SavingsNoticeCard } from './SavingsNoticeCard';
import { notifySavings } from './savings-notice';
import { useSavingsNoticeStore } from './savings-notice-store';
import { useClearWalletOnlyNoticeOnBlur } from './use-clear-wallet-only-notice-on-blur';

type Listener = () => void;
let blurListeners: Listener[] = [];

beforeEach(() => {
  blurListeners = [];
  useSavingsNoticeStore.setState({ goalId: null, notice: null });
  jest.mocked(useNavigation).mockReturnValue({
    addListener: jest.fn((event: string, listener: Listener) => {
      if (event === 'blur') blurListeners.push(listener);
      return () => {
        blurListeners = blurListeners.filter((l) => l !== listener);
      };
    }),
  } as unknown as ReturnType<typeof useNavigation>);
});

const leaveWallet = () =>
  act(() => {
    for (const listener of blurListeners) listener();
  });

function notify(walletOnly: boolean) {
  act(() => {
    notifySavings(
      'That savings plan has closed',
      'Here is your wallet.',
      'info'
    );
    const { notice } = useSavingsNoticeStore.getState();
    useSavingsNoticeStore.setState({
      notice: notice ? { ...notice, walletOnly } : notice,
    });
  });
}

// Local notice state only: nothing here needs PiggyVest.
describe('server keeps PiggyVest off: wallet-only notices', () => {
  it('clear when the customer leaves the wallet', () => {
    render(<SavingsNoticeCard colors={Colors.light} />);
    notify(true);
    expect(screen.getByText('That savings plan has closed')).toBeOnTheScreen();
    leaveWallet();
    expect(screen.queryByText('That savings plan has closed')).toBeNull();
  });

  it('leave other notices on the wallet', () => {
    render(<SavingsNoticeCard colors={Colors.light} />);
    notify(false);
    leaveWallet();
    expect(screen.getByText('That savings plan has closed')).toBeOnTheScreen();
  });

  it('clears only while active, through the latest clear callback', () => {
    const first = jest.fn();
    const latest = jest.fn();
    const { rerender } = renderHook(
      ({ active, clear }: { active: boolean; clear: () => void }) =>
        useClearWalletOnlyNoticeOnBlur(active, clear),
      { initialProps: { active: false, clear: first } }
    );
    leaveWallet();
    expect(first).not.toHaveBeenCalled();
    rerender({ active: true, clear: latest });
    leaveWallet();
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });
});
