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

test('detects protected DDL assembled by format with a literal target', () => {
  const source = `DO $wrapper$
BEGIN
  EXECUTE format(
    'ALTER FUNCTION %s SET search_path = %L',
    'private.fixture(integer)',
    ''
  );
END;
$wrapper$;`;

  assert.equal(hasDynamicFunctionDdl(source, 'private.fixture(integer)'), true);
});

test('fails closed for format DDL with an unresolved target', () => {
  const source = `DO $wrapper$
DECLARE
  v_target regprocedure;
BEGIN
  EXECUTE format('ALTER FUNCTION %s SET search_path = %L', v_target, '');
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

test('detects format-built privilege DDL with literal identifiers', () => {
  const source = `DO $wrapper$
BEGIN
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION %I.%I(uuid, uuid) TO authenticated',
    'private',
    'fixture'
  );
END;
$wrapper$;`;

  assert.equal(
    serializedInventoryDynamicDdl.hasDynamicPrivilegeDdl(
      source,
      'private.fixture(uuid, uuid)'
    ),
    true
  );
});

test('detects signature-less dynamic privilege DDL for protected functions', () => {
  const source = `DO $wrapper$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION private.confirm_order_inventory_reservations TO authenticated';
END;
$wrapper$;`;

  assert.equal(
    serializedInventoryDynamicDdl.hasDynamicPrivilegeDdl(
      source,
      'private.confirm_order_inventory_reservations(uuid, uuid)'
    ),
    true
  );
});

test('detects privilege DDL assigned through a format expression', () => {
  const source = `DO $wrapper$
DECLARE
  ddl text := format('GRANT EXECUTE ON FUNCTION %I.%I(uuid, uuid) TO authenticated', 'private', 'confirm_order_inventory_reservations');
BEGIN
  EXECUTE ddl;
END;
$wrapper$;`;

  assert.equal(
    serializedInventoryDynamicDdl.hasDynamicPrivilegeDdl(
      source,
      'private.confirm_order_inventory_reservations(uuid, uuid)'
    ),
    true
  );
});

test('fails closed on expression-built privilege payloads', () => {
  const source = `DO $wrapper$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION ' || quote_ident('private') || '.' || quote_ident('confirm_order_inventory_reservations') || '(uuid, uuid) TO authenticated';
END;
$wrapper$;`;

  assert.equal(
    serializedInventoryDynamicDdl.hasDynamicPrivilegeDdl(
      source,
      'private.confirm_order_inventory_reservations(uuid, uuid)'
    ),
    true
  );
});

test('fails closed on expression-built function DDL payloads', () => {
  const source = `DO $wrapper$
BEGIN
  EXECUTE 'ALTER FUNCTION ' || quote_ident('private.fixture') || '(integer) SET search_path = ' || quote_literal('');
END;
$wrapper$;`;

  assert.equal(hasDynamicFunctionDdl(source, 'private.fixture(integer)'), true);
});

test('detects function DDL assigned through a format expression', () => {
  const source = `DO $wrapper$
DECLARE
  ddl text := format('ALTER FUNCTION %s SET search_path = %L', 'private.fixture(integer)', '');
BEGIN
  EXECUTE ddl;
END;
$wrapper$;`;

  assert.equal(hasDynamicFunctionDdl(source, 'private.fixture(integer)'), true);
});

test('detects protected privilege DDL assigned to an execute variable', () => {
  const source = `DO $wrapper$
DECLARE
  ddl text := 'GRANT EXECUTE ON FUNCTION private.fixture(uuid) TO authenticated';
BEGIN
  EXECUTE ddl;
END;
$wrapper$;`;

  assert.equal(
    serializedInventoryDynamicDdl.hasDynamicPrivilegeDdl(
      source,
      'private.fixture(uuid)'
    ),
    true
  );
});

test('parses escape-string prefixes in dynamic privilege payloads', () => {
  const source = `DO $wrapper$
BEGIN
  EXECUTE E'GRANT EXECUTE ON FUNCTION private.fixture(uuid) TO authenticated';
END;
$wrapper$;`;

  assert.equal(
    serializedInventoryDynamicDdl.hasDynamicPrivilegeDdl(
      source,
      'private.fixture(uuid)'
    ),
    true
  );
});

test('detects dynamic schema-wide execution grants', () => {
  const source = `DO $wrapper$
BEGIN
  EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated';
END;
$wrapper$;`;

  assert.equal(
    serializedInventoryDynamicDdl.hasDynamicPrivilegeDdl(
      source,
      'private.fixture(uuid)'
    ),
    true
  );
  assert.equal(
    serializedInventoryDynamicDdl.hasDynamicPrivilegeDdl(
      source,
      'public.fixture(uuid)'
    ),
    false
  );
});

test('detects dynamic privilege DDL with unqualified targets', () => {
  const source = `DO $wrapper$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION fixture(uuid) TO authenticated';
END;
$wrapper$;`;

  assert.equal(
    serializedInventoryDynamicDdl.hasDynamicPrivilegeDdl(
      source,
      'private.fixture(uuid)'
    ),
    true
  );
});
