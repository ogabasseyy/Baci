import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryDynamicDdl } from './serialized_variant_inventory_concurrency_contract_dynamic_ddl.mjs';

const { hasDynamicFunctionDdl } = serializedInventoryDynamicDdl;

test('detects dynamic function DDL in quoted execution payloads', () => {
  const source = `DO $wrapper$
BEGIN
  EXECUTE $ddl$CREATE OR REPLACE FUNCTION private.fixture(integer) RETURNS void AS $body$ BEGIN NULL; END; $body$;$ddl$;
END;
$wrapper$;`;

  assert.equal(hasDynamicFunctionDdl(source, 'private.fixture(integer)'), true);
});

test('ignores unrelated execution payloads and function-name prefixes', () => {
  const source = `DO $wrapper$
BEGIN
  EXECUTE 'CREATE OR REPLACE FUNCTION private.fixture_old(integer) RETURNS void AS $body$ BEGIN NULL; END; $body$';
END;
$wrapper$;`;

  assert.equal(
    hasDynamicFunctionDdl(source, 'private.fixture(integer)'),
    false
  );
});

test('detects protected DDL assembled from concatenated literals', () => {
  const source = `DO $wrapper$
BEGIN
  EXECUTE 'CREATE OR REPLACE FUNCTION private.' ||
    'fixture(integer) RETURNS void AS $body$ BEGIN NULL; END; $body$';
END;
$wrapper$;`;

  assert.equal(hasDynamicFunctionDdl(source, 'private.fixture(integer)'), true);
});

test('detects dynamic privilege DDL for protected functions', () => {
  const source = `DO $wrapper$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION private.' ||
    'fixture(integer) TO authenticated';
END;
$wrapper$;`;

  assert.equal(
    serializedInventoryDynamicDdl.hasDynamicPrivilegeDdl(
      source,
      'private.fixture(integer)'
    ),
    true
  );
});
