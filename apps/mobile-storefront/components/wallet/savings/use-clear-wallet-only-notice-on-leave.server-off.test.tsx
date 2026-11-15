import { act, renderHook } from '@testing-library/react-native';
import { useNavigation } from 'expo-router';
import { notifySavings } from './savings-notice';
import { useSavingsNoticeStore } from './savings-notice-store';
import { useClearWalletOnlyNoticeOnLeave } from './use-clear-wallet-only-notice-on-leave';

type Listener = () => void;
let listeners: { event: string; listener: Listener }[] = [];

beforeEach(() => {
  listeners = [];
  useSavingsNoticeStore.setState({ goalId: null, notice: null });
  jest.mocked(useNavigation).mockReturnValue({
    addListener: jest.fn((event: string, listener: Listener) => {
      const entry = { event, listener };
      listeners.push(entry);
      return () => {
        listeners = listeners.filter((l) => l !== entry);
      };
    }),
  } as unknown as ReturnType<typeof useNavigation>);
});

const blur = () =>
  act(() => {
    for (const entry of listeners.filter((l) => l.event === 'blur')) {
      entry.listener();
    }
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

const title = () => useSavingsNoticeStore.getState().notice?.title;

// Local notice state only: nothing here needs PiggyVest.
describe('server keeps PiggyVest off: wallet-only notices clear on leaving the wallet', () => {
  it('keeps the note while the customer stays on the wallet', () => {
    renderHook(() => useClearWalletOnlyNoticeOnLeave());
    notify(true);
    expect(title()).toBe('That savings plan has closed');
  });

  it('clears it when another screen opens over the wallet or the tab changes', () => {
    renderHook(() => useClearWalletOnlyNoticeOnLeave());
    notify(true);
    blur();
    expect(title()).toBeUndefined();
  });

  it('clears it when the wallet is left by Back (the screen unmounts, no blur)', () => {
    const { unmount } = renderHook(() => useClearWalletOnlyNoticeOnLeave());
    notify(true);
    unmount();
    expect(title()).toBeUndefined();
  });

  it('leaves other notices alone on blur and on unmount', () => {
    const { unmount } = renderHook(() => useClearWalletOnlyNoticeOnLeave());
    notify(false);
    blur();
    unmount();
    expect(title()).toBe('That savings plan has closed');
  });
});
