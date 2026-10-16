import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NativeCartError } from '@/lib/cart/native-cart-error';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import {
  NativeCartAccountPanel,
  savedCartScopeMatches,
} from './NativeCartAccountPanel';

it('matches saved-cart scopes by value across distinct objects', () => {
  // Regression: reverting to reference equality would orphan a
  // completed read whenever React recreates the scope object.
  const saved = { userId: 'user-1', generation: 2 };
  const owner = { userId: 'user-1', generation: 2 };
  expect(saved).not.toBe(owner);
  expect(savedCartScopeMatches(saved, owner)).toBe(true);
  expect(
    savedCartScopeMatches(saved, { userId: 'user-2', generation: 2 })
  ).toBe(false);
  expect(
    savedCartScopeMatches(saved, { userId: 'user-1', generation: 3 })
  ).toBe(false);
  expect(savedCartScopeMatches(null, owner)).toBe(false);
});

const currentSnapshot = {
  cartId: '33333333-3333-4333-8333-333333333333',
  lines: [],
  version: 2,
} as never;

jest.mock('expo-crypto', () => ({ randomUUID: () => 'operation-one' }));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
it('retries the original account choice and keeps other choices blocked until it settles', async () => {
  const linkAccount = jest
    .fn()
    .mockRejectedValueOnce(new NativeCartError('temporarily_unavailable', true))
    .mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    accountsEnabled: true,
    accountUserId: '44444444-4444-4444-8444-444444444444',
    linkAccount,
    loadSavedCart: jest.fn().mockResolvedValue(undefined),
    savedCart: null,
    snapshot: currentSnapshot,
  });
  const view = render(<NativeCartAccountPanel />);
  await act(async () => {});
  fireEvent.press(view.getByText('Keep this cart on my account'));
  await waitFor(() =>
    expect(view.getByText('Retry the same cart choice')).toBeTruthy()
  );
  fireEvent.press(view.getByText('Retry the same cart choice'));
  await waitFor(() => expect(linkAccount).toHaveBeenCalledTimes(2));
  expect(linkAccount.mock.calls[1][0]).toEqual(linkAccount.mock.calls[0][0]);
});

it('acknowledges the observed saved cart when keeping the current cart', async () => {
  const linkAccount = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    accountsEnabled: true,
    accountUserId: '44444444-4444-4444-8444-444444444444',
    linkAccount,
    loadSavedCart: jest.fn().mockResolvedValue(undefined),
    savedCart: {
      cartId: '22222222-2222-4222-8222-222222222222',
      lines: [],
      version: 3,
    } as never,
    snapshot: currentSnapshot,
  });
  const view = render(<NativeCartAccountPanel />);
  await act(async () => {});
  fireEvent.press(view.getByText('Keep this cart on my account'));
  await waitFor(() => expect(linkAccount).toHaveBeenCalledTimes(1));
  expect(linkAccount.mock.calls[0][0]).toMatchObject({
    choice: 'keep_current',
    expectedSavedCartId: '22222222-2222-4222-8222-222222222222',
  });
});

it('does not publish a previous account choice after the shopper changes', async () => {
  let finish: () => void = () => undefined;
  const linkAccount = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  useNativeSharedCartStore.setState({
    enabled: true,
    accountsEnabled: true,
    accountUserId: '44444444-4444-4444-8444-444444444444',
    linkAccount,
    loadSavedCart: jest.fn().mockResolvedValue(undefined),
    savedCart: null,
    snapshot: currentSnapshot,
  });
  const view = render(<NativeCartAccountPanel />);
  await act(async () => {});
  fireEvent.press(view.getByText('Keep this cart on my account'));
  act(() =>
    useNativeSharedCartStore.setState({
      accountUserId: '55555555-5555-4555-8555-555555555555',
    })
  );
  await act(async () => {
    finish();
  });
  expect(view.queryByText('Cart linked to your account.')).toBeNull();
});

it('lets a new owner act while a previous owner attempt is still in flight', async () => {
  let finishFirst: () => void = () => undefined;
  let finishSecond: () => void = () => undefined;
  const linkAccount = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSecond = resolve;
        })
    )
    .mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    accountsEnabled: true,
    accountUserId: '44444444-4444-4444-8444-444444444444',
    linkAccount,
    loadSavedCart: jest.fn().mockResolvedValue(undefined),
    savedCart: null,
    snapshot: currentSnapshot,
  });
  const view = render(<NativeCartAccountPanel />);
  await act(async () => {});
  fireEvent.press(view.getByText('Keep this cart on my account'));
  expect(linkAccount).toHaveBeenCalledTimes(1);
  act(() =>
    useNativeSharedCartStore.setState({
      accountUserId: '55555555-5555-4555-8555-555555555555',
    })
  );
  await act(async () => {});
  fireEvent.press(view.getByText('Keep this cart on my account'));
  await waitFor(() => expect(linkAccount).toHaveBeenCalledTimes(2));
  // Finish the stale first request while the new owner's request is
  // still pending: its finally must not clear the new owner's flight
  // guard, so another click cannot launch a duplicate.
  await act(async () => {
    finishFirst();
  });
  fireEvent.press(view.getByText('Keep this cart on my account'));
  expect(linkAccount).toHaveBeenCalledTimes(2);
  await act(async () => {
    finishSecond();
  });
  await waitFor(() =>
    expect(view.getByText('Cart linked to your account.')).toBeTruthy()
  );
});

it('acts for the new owner when the switch and the tap land in the same commit', async () => {
  let finishFirst: () => void = () => undefined;
  const linkAccount = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        })
    )
    .mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    accountsEnabled: true,
    accountUserId: '44444444-4444-4444-8444-444444444444',
    linkAccount,
    loadSavedCart: jest.fn().mockResolvedValue(undefined),
    savedCart: null,
    snapshot: currentSnapshot,
  });
  const view = render(<NativeCartAccountPanel />);
  await act(async () => {});
  fireEvent.press(view.getByText('Keep this cart on my account'));
  expect(linkAccount).toHaveBeenCalledTimes(1);
  // Switch owner and tap again without an intervening awaited flush:
  // the tap must not submit under the stale owner's scope, and once
  // the new owner's saved-cart read settles the same choice submits
  // for the new owner instead of staying blocked by the old flight.
  act(() => {
    useNativeSharedCartStore.setState({
      accountUserId: '55555555-5555-4555-8555-555555555555',
    });
    fireEvent.press(view.getByText('Keep this cart on my account'));
  });
  expect(linkAccount).toHaveBeenCalledTimes(1);
  await act(async () => {});
  fireEvent.press(view.getByText('Keep this cart on my account'));
  expect(linkAccount).toHaveBeenCalledTimes(2);
  await act(async () => {
    finishFirst();
  });
});

it('offers saved-cart adoption when the native cart is empty', async () => {
  const linkAccount = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    accountsEnabled: true,
    accountUserId: '44444444-4444-4444-8444-444444444444',
    linkAccount,
    loadSavedCart: jest.fn().mockResolvedValue(undefined),
    savedCart: {
      cartId: '22222222-2222-4222-8222-222222222222',
      lines: [{}, {}],
      version: 3,
    } as never,
    snapshot: null,
  });
  const view = render(<NativeCartAccountPanel />);
  await act(async () => {});
  expect(view.queryByText('Keep this cart on my account')).toBeNull();
  fireEvent.press(view.getByText('Use saved cart'));
  await waitFor(() => expect(linkAccount).toHaveBeenCalledTimes(1));
  expect(linkAccount.mock.calls[0][0]).toMatchObject({
    choice: 'use_saved',
    expectedSavedCartId: '22222222-2222-4222-8222-222222222222',
  });
});

it('offers a fresh choice instead of a nonexistent retry after a definitive rejection', async () => {
  useNativeSharedCartStore.setState({
    enabled: true,
    accountsEnabled: true,
    accountUserId: '44444444-4444-4444-8444-444444444444',
    linkAccount: jest
      .fn()
      .mockRejectedValue(new NativeCartError('version_conflict')),
    loadSavedCart: jest.fn().mockResolvedValue(undefined),
    savedCart: null,
    snapshot: currentSnapshot,
  });
  const view = render(<NativeCartAccountPanel />);
  await act(async () => {});
  fireEvent.press(view.getByText('Keep this cart on my account'));
  await waitFor(() =>
    expect(
      view.getByText('Your carts changed. Review them and choose again.')
    ).toBeTruthy()
  );
  expect(view.queryByText('Retry the same cart choice')).toBeNull();
});

it('stays hidden and does not load account carts without accounts enrollment', async () => {
  const loadSavedCart = jest.fn().mockResolvedValue(undefined);
  useNativeSharedCartStore.setState({
    enabled: true,
    accountsEnabled: false,
    accountUserId: '44444444-4444-4444-8444-444444444444',
    linkAccount: jest.fn().mockResolvedValue(undefined),
    loadSavedCart,
    savedCart: null,
    snapshot: currentSnapshot,
  });
  const view = render(<NativeCartAccountPanel />);
  expect(view.queryByText('Save this cart to your account')).toBeNull();
  await waitFor(() => expect(loadSavedCart).not.toHaveBeenCalled());
});
