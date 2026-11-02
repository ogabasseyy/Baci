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
  ) => selector({ user: mockAuthUserId ? { id: mockAuthUserId } : null }),
}));

const reviewCopy =
  'Your PiggyVest wallet setup needs review. Please contact support before trying again.';
const pending = {
  provisioningStatus: 'pending' as const,
  requiresConsent: false,
  account: null,
};
const reviewError = (code: string) =>
  Object.assign(new Error('untrusted server-provided message'), { code });
const onRefresh = jest.fn();
const renderPanel = (merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74') =>
  render(
    <PiggyvestWalletSetupPanel
      colors={Colors.dark}
      merchantId={merchantId}
      needsPhone={false}
      onSubmitPhone={async () => ({ success: true })}
      onRefresh={onRefresh}
      onClose={jest.fn()}
    />
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthUserId = 'user-a-id';
  jest.mocked(piggyvestPrimaryWalletApi.read).mockResolvedValue(pending);
});

it.each([
  'OWNERSHIP_REVIEW_REQUIRED',
  'INTEREST_ROUTING_REVIEW_REQUIRED',
])('shows safe support guidance for a cold %s status', async (code) => {
  jest
    .mocked(piggyvestPrimaryWalletApi.read)
    .mockRejectedValueOnce(reviewError(code));
  renderPanel();

  expect(await screen.findByRole('alert')).toHaveTextContent(reviewCopy);
  expect(screen.queryByLabelText('BVN')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Create account number' })
  ).toBeNull();
  expect(screen.queryByText('untrusted server-provided message')).toBeNull();
});

it('shows safe support guidance when a pending refresh returns terminal review', async () => {
  jest
    .mocked(piggyvestPrimaryWalletApi.read)
    .mockResolvedValueOnce(pending)
    .mockRejectedValueOnce(reviewError('INTEREST_ROUTING_REVIEW_REQUIRED'));
  jest.mocked(piggyvestPrimaryWalletApi.create).mockResolvedValue(pending);
  renderPanel();
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );
  const refresh = await screen.findByRole('button', {
    name: 'Refresh PiggyVest account',
  });
  fireEvent.press(refresh);

  expect(await screen.findByRole('alert')).toHaveTextContent(reviewCopy);
  expect(
    screen.queryByText('Could not check your account. Please try again later.')
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Refresh PiggyVest account' })
  ).toBeNull();
});

it('shows support guidance when create returns terminal review', async () => {
  jest.mocked(piggyvestPrimaryWalletApi.read).mockResolvedValue(pending);
  jest
    .mocked(piggyvestPrimaryWalletApi.create)
    .mockRejectedValue(reviewError('OWNERSHIP_REVIEW_REQUIRED'));
  renderPanel();
  fireEvent.changeText(screen.getByLabelText('BVN'), '12345678901');
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(
    screen.getByRole('button', { name: 'Create account number' })
  );

  expect(await screen.findByRole('alert')).toHaveTextContent(reviewCopy);
  expect(screen.queryByLabelText('BVN')).toBeNull();
  expect(screen.queryByText('untrusted server-provided message')).toBeNull();
});

it('ignores an initial review read after switching accounts', async () => {
  let rejectFirstRead!: (error: Error) => void;
  const firstRead = new Promise<never>((_resolve, reject) => {
    rejectFirstRead = reject;
  });
  jest
    .mocked(piggyvestPrimaryWalletApi.read)
    .mockReturnValueOnce(firstRead)
    .mockResolvedValueOnce(pending);
  const view = renderPanel();

  await waitFor(() =>
    expect(piggyvestPrimaryWalletApi.read).toHaveBeenCalledTimes(1)
  );
  mockAuthUserId = 'user-b-id';
  view.rerender(
    <PiggyvestWalletSetupPanel
      colors={Colors.dark}
      merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
      needsPhone={false}
      onSubmitPhone={async () => ({ success: true })}
      onRefresh={onRefresh}
      onClose={jest.fn()}
    />
  );
  await waitFor(() =>
    expect(piggyvestPrimaryWalletApi.read).toHaveBeenCalledTimes(2)
  );
  await act(async () =>
    rejectFirstRead(reviewError('OWNERSHIP_REVIEW_REQUIRED'))
  );

  expect(screen.queryByText(reviewCopy)).toBeNull();
  expect(screen.getByLabelText('BVN')).toBeOnTheScreen();
});

it('starts a user-bound initial read after switching from a signed-out state', async () => {
  mockAuthUserId = null;
  const view = renderPanel();
  expect(piggyvestPrimaryWalletApi.read).not.toHaveBeenCalled();

  mockAuthUserId = 'user-b-id';
  view.rerender(
    <PiggyvestWalletSetupPanel
      colors={Colors.dark}
      merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
      needsPhone={false}
      onSubmitPhone={async () => ({ success: true })}
      onRefresh={onRefresh}
      onClose={jest.fn()}
    />
  );

  await waitFor(() =>
    expect(piggyvestPrimaryWalletApi.read).toHaveBeenCalledWith(
      '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      'user-b-id'
    )
  );
});

it('does not show the prior user review after switching accounts', async () => {
  jest
    .mocked(piggyvestPrimaryWalletApi.read)
    .mockRejectedValueOnce(reviewError('OWNERSHIP_REVIEW_REQUIRED'))
    .mockResolvedValueOnce(pending);
  const view = renderPanel();
  expect(await screen.findByRole('alert')).toHaveTextContent(reviewCopy);

  mockAuthUserId = 'user-b-id';
  view.rerender(
    <PiggyvestWalletSetupPanel
      colors={Colors.dark}
      merchantId="6b5cb8a4-5575-456c-b936-8cdfae30db74"
      needsPhone={false}
      onSubmitPhone={async () => ({ success: true })}
      onRefresh={onRefresh}
      onClose={jest.fn()}
    />
  );

  expect(screen.queryByText(reviewCopy)).toBeNull();
  await waitFor(() =>
    expect(piggyvestPrimaryWalletApi.read).toHaveBeenCalledTimes(2)
  );
  expect(piggyvestPrimaryWalletApi.read).toHaveBeenLastCalledWith(
    '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    'user-b-id'
  );
});

it('does not start the initial read while signed out', () => {
  mockAuthUserId = null;
  renderPanel();
  expect(piggyvestPrimaryWalletApi.read).not.toHaveBeenCalled();
});
