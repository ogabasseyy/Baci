import { peekCartPairingLink } from '@/lib/cart/pairing-link';
import { useNativeSharedCartStore } from '@/stores/native-shared-cart-store';
import { sharedCartWriteRevision } from '@/stores/shared-cart-writer';
import { dismissPairingLink, pairingRetryOperation } from './pairing-sync';

const prepare = jest.fn().mockResolvedValue(undefined);
const refresh = jest.fn().mockResolvedValue(undefined);
beforeEach(() => {
  jest.clearAllMocks();
  useNativeSharedCartStore.setState({
    status: 'ready',
    mergeConflicts: [],
    mergeConflictReason: undefined,
  });
});
it('prefers refresh for an existing snapshot or an empty device cart', () => {
  expect(
    pairingRetryOperation({ snapshot: { cartId: 'c1' }, prepare, refresh }, 2)
  ).toBe(refresh);
  expect(pairingRetryOperation({ snapshot: null, prepare, refresh }, 0)).toBe(
    refresh
  );
});
it('prefers prepare when no canonical cart exists and items are saved', () => {
  expect(pairingRetryOperation({ snapshot: null, prepare, refresh }, 2)).toBe(
    prepare
  );
});
it('falls back to whichever sync operation is bound', () => {
  expect(
    pairingRetryOperation(
      { snapshot: { cartId: 'c1' }, prepare, refresh: null },
      2
    )
  ).toBeNull();
  expect(
    pairingRetryOperation({ snapshot: null, prepare: null, refresh }, 0)
  ).toBe(refresh);
  expect(
    pairingRetryOperation({ snapshot: null, prepare: null, refresh: null }, 0)
  ).toBeNull();
});
it('clears pairing-owned conflicts on dismiss and marks checkout intent', () => {
  useNativeSharedCartStore.setState({
    status: 'ready',
    mergeConflicts: [{ productId: 'p1' }],
    mergeConflictReason: 'price_mismatch',
  });
  const before = sharedCartWriteRevision();
  dismissPairingLink();
  expect(useNativeSharedCartStore.getState().mergeConflicts).toEqual([]);
  expect(
    useNativeSharedCartStore.getState().mergeConflictReason
  ).toBeUndefined();
  expect(sharedCartWriteRevision()).toBe(before + 1);
  expect(peekCartPairingLink()).toBeNull();
});
it('keeps legacy choice conflicts gated on dismiss', () => {
  useNativeSharedCartStore.setState({
    status: 'choice_required',
    mergeConflicts: [{ productId: 'p1' }],
  });
  const before = sharedCartWriteRevision();
  dismissPairingLink();
  expect(useNativeSharedCartStore.getState().mergeConflicts).toHaveLength(1);
  expect(sharedCartWriteRevision()).toBe(before);
});
