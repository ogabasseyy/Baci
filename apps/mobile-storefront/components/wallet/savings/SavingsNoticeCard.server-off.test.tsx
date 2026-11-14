import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { SavingsNoticeCard } from './SavingsNoticeCard';
import { notifySavings, type SavingsNoticeTone } from './savings-notice';
import { useSavingsNoticeStore } from './savings-notice-store';

function iconNames() {
  return screen.UNSAFE_root.findAll(
    (node) => (node.type as unknown) === 'Ionicons'
  ).map((node) => ({ name: node.props.name, color: node.props.color }));
}

// The card renders local notice state only; nothing reaches the server.
describe('server keeps PiggyVest off: SavingsNoticeCard', () => {
  afterEach(() => {
    const dismiss = screen.queryByLabelText('Dismiss message');
    if (dismiss) fireEvent.press(dismiss);
  });

  it('renders nothing without a notice', () => {
    render(<SavingsNoticeCard colors={Colors.light} />);
    expect(screen.queryByTestId('savings-notice')).toBeNull();
  });

  it('shows a notice, then replaces it with a newer one', () => {
    render(<SavingsNoticeCard colors={Colors.light} />);
    act(() => notifySavings('Contribution pending', 'Waiting on PiggyVest.'));
    expect(screen.getByText('Contribution pending')).toBeOnTheScreen();
    expect(screen.getByText('Waiting on PiggyVest.')).toBeOnTheScreen();

    act(() => notifySavings('Savings updated', 'Nice!', 'success'));
    expect(screen.getByText('Savings updated')).toBeOnTheScreen();
    expect(screen.getByText('Nice!')).toBeOnTheScreen();
    expect(screen.queryByText('Contribution pending')).toBeNull();
    expect(screen.getAllByTestId('savings-notice')).toHaveLength(1);
  });

  it('leaves a wallet-only notice to the wallet, never inside a goal sheet', () => {
    act(() => notifySavings('That savings plan has closed', undefined, 'info'));
    act(() => {
      const { notice } = useSavingsNoticeStore.getState();
      useSavingsNoticeStore.setState({
        goalId: null,
        notice: notice ? { ...notice, walletOnly: true } : notice,
      });
    });
    const sheet = render(
      <SavingsNoticeCard colors={Colors.light} goalId="goal-b" inSheet />
    );
    expect(sheet.queryByTestId('savings-notice')).toBeNull();
    sheet.unmount();
    render(<SavingsNoticeCard colors={Colors.light} />);
    expect(screen.getByText('That savings plan has closed')).toBeOnTheScreen();
  });

  it('omits the message line when there is no message', () => {
    render(<SavingsNoticeCard colors={Colors.light} />);
    act(() => notifySavings('Checking contributions'));
    expect(screen.getByText('Checking contributions')).toBeOnTheScreen();
    expect(screen.getByTestId('savings-notice')).toBeOnTheScreen();
  });

  it('clears the notice when the dismiss button is pressed', () => {
    render(<SavingsNoticeCard colors={Colors.light} />);
    act(() => notifySavings('Status unavailable', 'Try later.', 'warning'));
    fireEvent.press(screen.getByLabelText('Dismiss message'));
    expect(screen.queryByTestId('savings-notice')).toBeNull();
    expect(screen.queryByText('Status unavailable')).toBeNull();
  });

  it.each<[SavingsNoticeTone, string, string]>([
    ['success', 'checkmark-circle', Colors.dark.success],
    ['info', 'information-circle', Colors.dark.icon],
    ['warning', 'alert-circle', Colors.dark.warning],
  ])('renders the %s tone icon and colour in dark mode', (tone, icon, colour) => {
    render(<SavingsNoticeCard colors={Colors.dark} />);
    act(() => notifySavings(`A ${tone} notice`, 'Details.', tone));
    expect(screen.getByText(`A ${tone} notice`)).toBeOnTheScreen();
    expect(iconNames()).toEqual([
      { name: icon, color: colour },
      { name: 'close', color: Colors.dark.textSecondary },
    ]);
  });

  it('takes the outer spacing it is given (the wallet insets it like its cards)', () => {
    act(() => notifySavings('Savings updated', undefined, 'success'));
    render(
      <SavingsNoticeCard
        colors={Colors.light}
        style={{ marginHorizontal: 16 }}
      />
    );
    expect(screen.getByTestId('savings-notice')).toHaveStyle({
      marginHorizontal: 16,
    });
  });
});
