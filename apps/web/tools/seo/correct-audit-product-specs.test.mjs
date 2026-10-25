import assert from 'node:assert/strict';
import { test } from 'vitest';
import { correctAuditProduct } from './correct-audit-product-specs.mjs';

import records from './fixtures/audit-20261025-specs.json' with {
  type: 'json',
};

const correct = (slug) =>
  correctAuditProduct(records.find((row) => row.slug === slug));
test('16-inch M3 Max no longer publishes 14-inch display, power or dimensions', () => {
  const row = correct('macbook-pro-16-inch-m3-max-2023');
  assert.equal(row.key_specs.screen_size_inches, 16.2);
  assert.equal(row.key_specs.charging_watt, 140);
  assert.equal(row.key_specs.weight_g, 2160);
  assert.doesNotMatch(JSON.stringify(row.specifications), /14\.2|3024|14-inch/);
});
test('M2 Max does not inherit M3 Pro chip, GPU or memory claims', () => {
  const row = correct('macbook-pro-16-inch-m2-max-2023');
  assert.equal(row.key_specs.chipset, 'Apple M2 Max');
  assert.doesNotMatch(JSON.stringify(row), /M3 Pro|18-core|36GB/);
});
test('Go 4 matches manufacturer capacity and dimensions, Go 3 unverified capacity is withheld', () => {
  const row = correct('jbl-go-4');
  assert.equal(row.key_specs.battery_mah, 850);
  assert.equal(row.key_specs.dimensions_mm, '94.3 x 75.7 x 42.2');
  assert.doesNotMatch(JSON.stringify(row), /2800mAh|89 x 75 x 42/);
  assert.equal(correct('jbl-go-3').key_specs.battery_mah, null);
  assert.doesNotMatch(JSON.stringify(correct('jbl-go-3')), /2700mAh/);
});
test('AirPods expose explicit each/case weights without rounding 4.3g into an integer', () => {
  for (const slug of ['airpods-4', 'apple-airpods-4-anc']) {
    const row = correct(slug);
    assert.equal(row.key_specs.weight_g, null);
    assert.equal(row.key_specs.battery_mah, null);
    assert.match(JSON.stringify(row.specifications), /4.3g per earbud/);
    assert.match(
      JSON.stringify(row.specifications),
      slug === 'airpods-4' ? /32.3g/ : /34.7g/
    );
    assert.doesNotMatch(JSON.stringify(row.specifications), /380mAh/);
  }
});
test('unknown products are unchanged and source snapshots are not mutated', () => {
  const input = {
    slug: 'other-merchant-product',
    key_specs: { battery_mah: 2800 },
    specifications: [],
  };
  assert.deepEqual(correctAuditProduct(input), input);
  const before = JSON.stringify(records);
  for (const record of records) correctAuditProduct(record);
  assert.equal(JSON.stringify(records), before);
});

test('reapplying the correction does not duplicate manufacturer provenance', () => {
  for (const record of records) {
    const after = correctAuditProduct(record);
    assert.deepEqual(correctAuditProduct(after), after);
  }
});
