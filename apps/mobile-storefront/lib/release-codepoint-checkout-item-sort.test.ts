import { CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY } from '@/config/checkout-storage';

function loadMark() {
  return require('./mark-codepoint-checkout-item-sort') as typeof import('./mark-codepoint-checkout-item-sort');
}

function loadRelease() {
  return require('./release-codepoint-checkout-item-sort') as typeof import('./release-codepoint-checkout-item-sort');
}

const storage = new Map<string, string>();
const mockSetItem = jest.fn(async (key: string, value: string) => {
  storage.set(key, value);
});
const mockRemoveItem = jest.fn(async (key: string) => {
  storage.delete(key);
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: (key: string, value: string) => mockSetItem(key, value),
  removeItem: (key: string) => mockRemoveItem(key),
}));

const generation = '46ed63d7-5f10-49f0-9456-9ff571bec43f';
const otherGeneration = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function markerKey(id: string): string {
  return `${CHECKOUT_IDEMPOTENCY_ITEM_SORT_V2_STORAGE_KEY}:${id}`;
}

beforeEach(() => {
  jest.resetModules();
  storage.clear();
  mockSetItem.mockClear();
  mockRemoveItem.mockClear();
});

async function flushTicks(count = 10): Promise<void> {
  for (let tick = 0; tick < count; tick += 1) {
    await Promise.resolve();
  }
}

it('releases only the finalized generation marker', async () => {
  storage.set(markerKey(generation), '1');
  storage.set(markerKey(otherGeneration), '1');
  let removed!: () => void;
  const removedPromise = new Promise<void>((resolve) => {
    removed = resolve;
  });
  mockRemoveItem.mockImplementationOnce(async (key: string) => {
    storage.delete(key);
    removed();
  });
  await loadRelease().releaseCodepointCheckoutItemSort(generation);
  await removedPromise;
  expect(storage.get(markerKey(generation))).toBeUndefined();
  expect(storage.get(markerKey(otherGeneration))).toBe('1');
});

it('heals a restored marker deleted by an in-flight removal', async () => {
  storage.set(markerKey(generation), '1');
  // Hold the queued removal at the gate so the restore lands first.
  let removalEntered!: () => void;
  const removalEnteredPromise = new Promise<void>((resolve) => {
    removalEntered = resolve;
  });
  let releaseRemoval!: () => void;
  const removalGate = new Promise<void>((resolve) => {
    releaseRemoval = resolve;
  });
  mockRemoveItem.mockImplementationOnce(async (key: string) => {
    removalEntered();
    await removalGate;
    storage.delete(key);
  });
  await loadRelease().releaseCodepointCheckoutItemSort(generation);
  await removalEnteredPromise;
  // Cart rollback restores the marker while the removal is in flight.
  await loadMark().markCodepointCheckoutItemSort(generation);
  releaseRemoval();
  await flushTicks();
  // The in-flight delete landed after the restore, so the
  // post-settlement verification rewrote the idempotent marker.
  expect(storage.get(markerKey(generation))).toBe('1');
});

it('skips a detached removal when a newer mark completed before it runs', async () => {
  const queue =
    require('./checkout-generation-storage-queue') as typeof import('./checkout-generation-storage-queue');
  // Hold the shared queue so the detached removal stays queued while the
  // restore lands: the removal must recheck and stand down when it runs.
  let gateEntered!: () => void;
  const gateEnteredPromise = new Promise<void>((resolve) => {
    gateEntered = resolve;
  });
  let openGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  const gateOp = queue.checkoutGenerationStorageQueue.enqueue(async () => {
    gateEntered();
    await gate;
  });
  await gateEnteredPromise;
  await loadMark().markCodepointCheckoutItemSort(generation);
  await loadRelease().releaseCodepointCheckoutItemSort(generation);
  // A retry re-marks before the detached removal executes.
  await loadMark().markCodepointCheckoutItemSort(generation);
  openGate();
  await gateOp;
  await flushTicks();
  expect(mockRemoveItem).not.toHaveBeenCalled();
  expect(storage.get(markerKey(generation))).toBe('1');
});

it('removes idempotently when releases stack without a newer mark', async () => {
  storage.set(markerKey(generation), '1');
  let removals = 0;
  let bothRemoved!: () => void;
  const bothRemovedPromise = new Promise<void>((resolve) => {
    bothRemoved = resolve;
  });
  mockRemoveItem.mockImplementation(async (key: string) => {
    storage.delete(key);
    removals += 1;
    if (removals === 2) {
      bothRemoved();
    }
  });
  await loadRelease().releaseCodepointCheckoutItemSort(generation);
  await loadRelease().releaseCodepointCheckoutItemSort(generation);
  await bothRemovedPromise;
  expect(storage.get(markerKey(generation))).toBeUndefined();
  expect(mockRemoveItem).toHaveBeenCalledTimes(2);
});
