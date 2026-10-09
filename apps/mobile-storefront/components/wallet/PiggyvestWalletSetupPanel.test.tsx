import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import Colors from '@/constants/Colors';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import { PiggyvestWalletSetupPanel } from './PiggyvestWalletSetupPanel';

jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { create: jest.fn(), read: jest.fn() },
}));

let mockAuthUserId: string | null = 'user-a-id';
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: { user: { id: string } | null }) => unknown
  ) =>
    selector({
      user: mockAuthUserId ? { id: mockAuthUserId } : null,
    }),
}));

it('explains when a read-only refresh still has no verified account', async () => {
  jest.mocked(piggyvestPrimaryWalletApi.create).mockResolvedValue({
    provisioningStatus: 'pending',
    requiresConsent: false,
    account: null,
  });
  jest.mocked(piggyvestPrimaryWalletApi.read).mockResolvedValue({
    provisioningStatus: 'pending',
    requiresConsent: false,
    account: null,
  });
  render(
    <PiggyvestWalletSetupPanel
      colors={Colors.dark}
      merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
      needsPhone={false}
      onSubmitPhone={async () => ({ success: true })}
      onRefresh={jest.fn()}
      onClose={jest.fn()}
    />
  );
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Refresh PiggyVest account' })
    ).toBeOnTheScreen()
  );
  fireEvent.press(
    screen.getByRole('button', { name: 'Refresh PiggyVest account' })
  );
  await waitFor(() =>
    expect(
      screen.getByText(
        'Your account is still being prepared. Check again shortly.'
      )
    ).toBeOnTheScreen()
  );
  expect(screen.queryByLabelText('BVN')).toBeNull();
});

it('keeps the form actionable with input preserved when creation fails', async () => {
  // A rejected creation (profile/ownership/transport) must not strand
  // the user on a pending screen: the form stays mounted with its BVN
  // so the failure can be corrected and resubmitted. Flipping pending
  // before the outcome would unmount the form and wipe its state even
  // if pending were reset in the catch.
  jest
    .mocked(piggyvestPrimaryWalletApi.create)
    .mockRejectedValue(new Error('Unavailable'));
  const onRefresh = jest.fn();
  render(
    <PiggyvestWalletSetupPanel
      colors={Colors.dark}
      merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
      needsPhone={false}
      onSubmitPhone={async () => ({ success: true })}
      onRefresh={onRefresh}
      onClose={jest.fn()}
    />
  );
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  await waitFor(() =>
    expect(
      screen.getByText(
        'Wallet setup could not be confirmed. Refresh your account before trying again.'
      )
    ).toBeOnTheScreen()
  );
  expect(screen.getByLabelText('BVN')).toHaveProp('value', '12345678901');
  expect(
    screen.queryByRole('button', { name: 'Refresh PiggyVest account' })
  ).toBeNull();
  expect(onRefresh).not.toHaveBeenCalled();
});
it('refreshes the wallet when creation returns an account', async () => {
  jest.mocked(piggyvestPrimaryWalletApi.create).mockResolvedValue({
    provisioningStatus: 'ready',
    requiresConsent: false,
    account: {
      accountName: 'Test Account',
      accountNumber: '1234567890',
      bankName: 'Test Bank',
      provider: 'piggyvest',
    },
  });
  const onRefresh = jest.fn();
  render(
    <PiggyvestWalletSetupPanel
      colors={Colors.dark}
      merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
      needsPhone={false}
      onSubmitPhone={async () => ({ success: true })}
      onRefresh={onRefresh}
      onClose={jest.fn()}
    />
  );
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
});
it('resets retained setup state when the account changes', async () => {
  mockAuthUserId = 'user-a-id';
  jest
    .mocked(piggyvestPrimaryWalletApi.create)
    .mockRejectedValue(new Error('Unavailable'));
  const onRefresh = jest.fn();
  // Fresh element per render: zustand notifies subscribers on an account
  // change in production; here each render re-invokes the selector (see
  // the auth-store mock), which only happens with a new element.
  const renderPanel = () => (
    <PiggyvestWalletSetupPanel
      colors={Colors.dark}
      merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
      needsPhone={false}
      onSubmitPhone={async () => ({ success: true })}
      onRefresh={onRefresh}
      onClose={jest.fn()}
    />
  );
  const { rerender } = render(renderPanel());
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  await waitFor(() =>
    expect(
      screen.getByText(
        'Wallet setup could not be confirmed. Refresh your account before trying again.'
      )
    ).toBeOnTheScreen()
  );
  expect(screen.getByLabelText('BVN')).toHaveProp('value', '12345678901');
  // Switch accounts with the failed setup still mounted: B must get a
  // fresh form, never A's retained BVN or failure state.
  mockAuthUserId = 'user-b-id';
  rerender(renderPanel());
  await waitFor(() =>
    expect(screen.getByLabelText('BVN')).toHaveProp('value', '')
  );
  expect(
    screen.queryByText(
      'Wallet setup could not be confirmed. Refresh your account before trying again.'
    )
  ).toBeNull();
  expect(onRefresh).not.toHaveBeenCalled();
});
it('ignores in-flight creation results from a previous account', async () => {
  mockAuthUserId = 'user-a-id';
  let resolveCreate!: (
    value: Awaited<ReturnType<typeof piggyvestPrimaryWalletApi.create>>
  ) => void;
  jest.mocked(piggyvestPrimaryWalletApi.create).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveCreate = resolve;
    })
  );
  const onRefresh = jest.fn();
  // Fresh element per render: zustand notifies subscribers on an account
  // change in production; here each render re-invokes the selector (see
  // the auth-store mock), which only happens with a new element.
  const renderPanel = () => (
    <PiggyvestWalletSetupPanel
      colors={Colors.dark}
      merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
      needsPhone={false}
      onSubmitPhone={async () => ({ success: true })}
      onRefresh={onRefresh}
      onClose={jest.fn()}
    />
  );
  const { rerender } = render(renderPanel());
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  // Switch accounts while A's creation is in flight, then let it land
  // with an account: B's view must not refresh or flip to pending.
  mockAuthUserId = 'user-b-id';
  rerender(renderPanel());
  resolveCreate({
    provisioningStatus: 'ready',
    requiresConsent: false,
    account: {
      accountName: 'Test Account',
      accountNumber: '1234567890',
      bankName: 'Test Bank',
      provider: 'piggyvest',
    },
  });
  // Flush the landed creation through the panel continuation: it must be
  // discarded (stale account) rather than refreshing or flipping pending.
  await act(async () => {});
  expect(onRefresh).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('button', { name: 'Refresh PiggyVest account' })
  ).toBeNull();
  expect(screen.getByLabelText('BVN')).toHaveProp('value', '');
});
