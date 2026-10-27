import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  check,
  checkoutAt,
  cleanupLatchFixtures,
  fixture,
} from './check-gigl-cutover-latch.test-fixtures.mjs';

afterEach(cleanupLatchFixtures);

test('a promoted equivalent worker can be re-smoked without trusting its old latch', () => {
  const { origin, root, tip, base, manifest } = fixture();
  const checkout = checkoutAt(origin, root, 'checkout', tip);
  const { result, values } = check({
    checkout,
    latch: base,
    installed: manifest,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(values.latched, 'false');
  assert.equal(values.tracking_stale, 'true');
  assert.equal(values.installed_sha, manifest);
  assert.equal(values.installed_tracking_stale, 'false');
  assert.equal(values.manifest_drift, 'false');
});

test('missing smoke proof can recover only through a fresh smoke of equivalent installed code', () => {
  const { origin, root, tip, manifest } = fixture();
  const checkout = checkoutAt(origin, root, 'checkout', tip);
  const { values } = check({ checkout, installed: manifest });
  assert.equal(values.latched, 'false');
  assert.equal(values.installed_tracking_stale, 'false');
});

test('a newer GIGL migration blocks recovery even with no tracking change in the latest push', () => {
  const { origin, root, tip, base } = fixture();
  const checkout = checkoutAt(origin, root, 'checkout', tip);
  const { values } = check({ checkout, installed: base });
  assert.equal(values.installed_tracking_stale, 'true');
});

test('dependency drift still blocks an otherwise equivalent worker', () => {
  const { origin, root, tip, tracking } = fixture();
  const checkout = checkoutAt(origin, root, 'checkout', tip);
  const { values } = check({ checkout, installed: tracking });
  assert.equal(values.installed_tracking_stale, 'false');
  assert.equal(values.manifest_drift, 'true');
});

for (const installed of [null, 'invalid', '0'.repeat(40)]) {
  test(`unverifiable installation fails closed: ${installed}`, () => {
    const { origin, root, tip } = fixture();
    const checkout = checkoutAt(origin, root, 'checkout', tip);
    const { values } = check({ checkout, installed });
    assert.equal(values.installed_tracking_stale, 'true');
    assert.equal(values.manifest_drift, 'true');
    if (installed !== '0'.repeat(40)) assert.equal(values.installed_sha, '');
  });
}
