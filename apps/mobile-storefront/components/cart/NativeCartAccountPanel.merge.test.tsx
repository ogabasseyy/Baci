import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NativeCartError } from '@/lib/cart/native-cart-error';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { NativeCartAccountPanel } from './NativeCartAccountPanel';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'merge-operation' }));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
const owner = '44444444-4444-4444-8444-444444444444';
const productId = '33333333-3333-4333-8333-333333333333';
const merchantId = '11111111-1111-4111-8111-111111111111';
const line = {
  id: productId,
  item: { productId },
  quantity: 3,
  unitPriceMinor: 100,
  lineTotalMinor: 300,
};
const current = {
  cartId: '22222222-2222-4222-8222-222222222222',
  merchantId,
  state: 'active' as const,
  version: 3,
  currency: 'NGN',
  subtotalMinor: 300,
  totalMinor: 300,
  estimatedTotals: false,
  expiresAt: '2099-01-01T00:00:00Z',
  lines: [
    {
      ...line,
      negotiatedUnitPriceMinor: 90,
      negotiationStatus: 'accepted' as const,
    },
  ],
};
const saved = {
  ...current,
  cartId: '55555555-5555-4555-8555-555555555555',
  version: 7,
  lines: [
    {
      ...line,
      quantity: 1,
      voucherToken: 'saved-voucher',
      voucherAwardId: '66666666-6666-4666-8666-666666666666',
    },
  ],
};

it.each([
  [
    'Keep saved offer',
    'incoming',
    {
      voucherToken: 'saved-voucher',
      voucherAwardId: '66666666-6666-4666-8666-666666666666',
      quantity: 1,
    },
  ],
  [
    'Keep this cart offer',
    'existing',
    {
      negotiatedUnitPriceMinor: 90,
      negotiationStatus: 'accepted',
      quantity: 3,
    },
  ],
] as const)('%s submits the matching server-side resolution and preserves its exact retry', async (label, keep, expectedLine) => {
  const linkAccount = jest
    .fn()
    .mockRejectedValueOnce(new NativeCartError('temporarily_unavailable', true))
    .mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    accountsEnabled: true,
    accountUserId: owner,
    linkAccount,
    loadSavedCart: jest.fn().mockResolvedValue(undefined),
    savedCart: saved,
    snapshot: current,
  });
  const view = render(<NativeCartAccountPanel />);
  await act(async () => {});
  fireEvent.press(view.getByText(label));
  fireEvent.press(view.getByText('Combine both carts'));
  await waitFor(() => expect(linkAccount).toHaveBeenCalledTimes(1));
  expect(linkAccount.mock.calls[0][0]).toMatchObject({
    operationId: 'merge-operation',
    choice: 'merge',
    expectedSavedCartId: saved.cartId,
    expectedSavedVersion: 7,
    expectedCurrentVersion: 3,
    resolutions: [{ item: { productId }, keep }],
    lines: [expectedLine],
  });
  // findByText, not getByText: the rejection catch → setState →
  // rerender needs event-loop turns after linkAccount is merely
  // *called*, and a sync query races it under CI load.
  fireEvent.press(await view.findByText('Retry the same cart choice'));
  await waitFor(() => expect(linkAccount).toHaveBeenCalledTimes(2));
  expect(linkAccount.mock.calls[1][0]).toEqual(linkAccount.mock.calls[0][0]);
});

it('discards merge picks when the saved cart version changes before submit', async () => {
  const linkAccount = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    accountsEnabled: true,
    accountUserId: owner,
    linkAccount,
    loadSavedCart: jest.fn().mockResolvedValue(undefined),
    savedCart: saved,
    snapshot: current,
  });
  const view = render(<NativeCartAccountPanel />);
  await act(async () => {});
  fireEvent.press(view.getByText('Keep saved offer'));
  // The saved cart moves to a new version with a different quantity:
  // the earlier pick no longer describes what the shopper reviewed.
  act(() =>
    useNativeSharedCartStore.setState({
      savedCart: {
        ...saved,
        version: 8,
        lines: [{ ...saved.lines[0], quantity: 2, lineTotalMinor: 200 }],
      },
    })
  );
  fireEvent.press(view.getByText('Combine both carts'));
  expect(linkAccount).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('Keep saved offer'));
  fireEvent.press(view.getByText('Combine both carts'));
  await waitFor(() => expect(linkAccount).toHaveBeenCalledTimes(1));
  expect(linkAccount.mock.calls[0][0]).toMatchObject({
    expectedSavedVersion: 8,
    expectedCurrentVersion: 3,
    resolutions: [{ item: { productId }, keep: 'incoming' }],
  });
});

it('blocks fresh choices until the saved-cart lookup succeeds, and offers lookup retry after failure', async () => {
  const loadSavedCart = jest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(undefined);
  const linkAccount = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    accountsEnabled: true,
    accountUserId: owner,
    linkAccount,
    loadSavedCart,
    savedCart: null,
    snapshot: current,
  });
  const view = render(<NativeCartAccountPanel />);
  fireEvent.press(view.getByText('Keep this cart on my account'));
  await act(async () => {});
  expect(linkAccount).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('Retry loading saved cart'));
  await waitFor(() => expect(loadSavedCart).toHaveBeenCalledTimes(2));
  await act(async () => {});
  fireEvent.press(view.getByText('Keep this cart on my account'));
  await waitFor(() => expect(linkAccount).toHaveBeenCalledTimes(1));
  expect(linkAccount.mock.calls[0][0]).toMatchObject({
    choice: 'keep_current',
    expectedSavedCartId: null,
  });
});

it('does not let a late previous-owner lookup enable the new owner choices', async () => {
  let finishPrevious: () => void = () => undefined;
  const loadSavedCart = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPrevious = resolve;
        })
    )
    .mockImplementation(() => new Promise<void>(() => {}));
  const linkAccount = jest.fn();
  useNativeSharedCartStore.setState({
    enabled: true,
    accountsEnabled: true,
    accountUserId: owner,
    linkAccount,
    loadSavedCart,
    savedCart: null,
    snapshot: current,
  });
  const view = render(<NativeCartAccountPanel />);
  act(() => useNativeSharedCartStore.setState({ accountUserId: merchantId }));
  await act(async () => {
    finishPrevious();
  });
  fireEvent.press(view.getByText('Keep this cart on my account'));
  expect(linkAccount).not.toHaveBeenCalled();
});

it.each([
  'version_conflict',
  'refresh_required',
  'unauthorized',
  'session_changed',
])('reloads saved observation after %s and keeps fresh choices blocked if reloading fails', async (code) => {
  const loadSavedCart = jest
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementation(async () => {
      useNativeSharedCartStore.setState({
        savedCart: { ...saved, version: 9 },
      });
    });
  const linkAccount = jest
    .fn()
    .mockRejectedValueOnce(new NativeCartError(code))
    .mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    accountsEnabled: true,
    accountUserId: owner,
    linkAccount,
    loadSavedCart,
    savedCart: saved,
    snapshot: current,
  });
  const view = render(<NativeCartAccountPanel />);
  await act(async () => {});
  fireEvent.press(view.getByText('Keep saved offer'));
  fireEvent.press(view.getByText('Combine both carts'));
  await waitFor(() => expect(loadSavedCart).toHaveBeenCalledTimes(2));
  fireEvent.press(view.getByText('Use saved cart'));
  fireEvent.press(view.getByText('Keep this cart on my account'));
  expect(linkAccount).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByText('Retry loading saved cart'));
  await act(async () => {});
  // Old offer picks were invalidated with the observation.
  fireEvent.press(view.getByText('Combine both carts'));
  expect(linkAccount).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByText('Keep saved offer'));
  fireEvent.press(view.getByText('Combine both carts'));
  await waitFor(() => expect(linkAccount).toHaveBeenCalledTimes(2));
  expect(linkAccount.mock.calls[1][0]).toMatchObject({
    expectedSavedVersion: 9,
    expectedCurrentVersion: 3,
  });
});
