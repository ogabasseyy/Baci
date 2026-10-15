/**
 * Root manual mock for `react-native-mmkv` (auto-applied to every
 * suite without a `jest.mock()` call): a memory-backed bucket per
 * test file, so persistence-dependent modules exercise their
 * durable path under jest the way a device does. Suites needing
 * failure control declare their own `jest.mock` factory (which
 * takes precedence), e.g. pending-vtu-idempotency-store.test.ts.
 *
 * Added for Codex R97 P1: a null store now reports writes as
 * failed, so the suite-wide default must be a WORKING store —
 * otherwise every remember() refuses and no submit test can run.
 */

const buckets = new Map();

function bucketFor(id) {
  let bucket = buckets.get(id);
  if (!bucket) {
    bucket = new Map();
    buckets.set(id, bucket);
  }
  return bucket;
}

function createMMKV({ id } = {}) {
  const bucket = bucketFor(id ?? 'default');
  return {
    getString: (key) => bucket.get(key) ?? null,
    set: (key, value) => {
      bucket.set(key, value);
    },
    remove: (key) => {
      bucket.delete(key);
    },
    clearAll: () => {
      bucket.clear();
    },
    getAllKeys: () => [...bucket.keys()],
  };
}

module.exports = { createMMKV };
