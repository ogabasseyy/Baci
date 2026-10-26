import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { sharedCartWriteRevision } from '@/stores/shared-cart-writer';
import { NativeCartAccountPanel } from './NativeCartAccountPanel';

const currentSnapshot = {
  cartId: '33333333-3333-4333-8333-333333333333',
  lines: [],
  version: 2,
} as never;

jest.mock('expo-crypto', () => ({ randomUUID: () => 'operation-one' }));
jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));
it('marks an account cart choice as a checkout-fencing intent', async () => {
  const linkAccount = jest.fn().mockResolvedValue(undefined);
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
  const before = sharedCartWriteRevision();
  fireEvent.press(view.getByText('Keep this cart on my account'));
  await waitFor(() => expect(linkAccount).toHaveBeenCalledTimes(1));
  expect(sharedCartWriteRevision()).toBe(before + 1);
});
