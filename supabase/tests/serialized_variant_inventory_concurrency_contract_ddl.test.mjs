import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';

const { latestFunctionBody } = serializedInventoryContract;

test('function extraction invalidates generic ROUTINE DDL', () => {
  const definition =
    'CREATE FUNCTION private.fixture(integer) RETURNS void AS $$ BEGIN NULL; END; $$;';
  for (const invalidator of [
    'DROP ROUTINE private.fixture(integer);',
    'ALTER ROUTINE private.fixture(integer) RENAME TO fixture_old;',
    'ALTER ROUTINE private.fixture(integer) SET SCHEMA public;',
    'DROP FUNCTION private.fixture(integer), private.other(text);',
    'DROP ROUTINE private.other(text), private.fixture(integer);',
  ]) {
    assert.throws(
      () =>
        latestFunctionBody('private.fixture(integer)', [
          `${definition}\n${invalidator}`,
        ]),
      /missing private\.fixture/
    );
  }
});
