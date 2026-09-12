import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractRedvaultInventoryRelease } from './extract-redvault-inventory-release.mjs';

const privateMarker =
  'CREATE OR REPLACE FUNCTION private.release_order_inventory_units(';
const publicMarker =
  'CREATE OR REPLACE FUNCTION public.release_order_inventory_units(';

test('extracts only the complete private release definition', () => {
  assert.equal(
    extractRedvaultInventoryRelease(
      `prefix ${privateMarker}body${publicMarker}suffix`
    ),
    `${privateMarker}body`
  );
});

for (const [name, source] of [
  ['both missing', 'unrelated SQL'],
  ['private missing', publicMarker],
  ['public missing', privateMarker],
  ['reversed', publicMarker + privateMarker],
]) {
  test(`rejects inventory release markers when ${name}`, () => {
    assert.throws(
      () => extractRedvaultInventoryRelease(source),
      /markers are missing or out of order/
    );
  });
}
