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

test('numeric signatures are invalidated through decimal aliases', () => {
  const definition =
    'CREATE FUNCTION private.fixture(numeric) RETURNS void AS $$ BEGIN NULL; END; $$;';
  for (const invalidator of [
    'DROP FUNCTION private.fixture(decimal);',
    'ALTER FUNCTION private.fixture(decimal) RENAME TO fixture_old;',
    'ALTER FUNCTION private.fixture(decimal) SET SCHEMA public;',
  ]) {
    assert.throws(
      () =>
        latestFunctionBody('private.fixture(numeric)', [
          `${definition}\n${invalidator}`,
        ]),
      /missing private\.fixture/
    );
  }
});

test('schema-qualified built-in types replace the effective function body', () => {
  const body = latestFunctionBody('private.fixture(uuid)', [
    "CREATE FUNCTION private.fixture(uuid) RETURNS text AS $$ BEGIN RETURN 'old'; END; $$;",
    "CREATE OR REPLACE FUNCTION private.fixture(pg_catalog.uuid) RETURNS text AS $$ BEGIN RETURN 'new'; END; $$;",
  ]);

  assert.match(body, /RETURN 'new'/);
  assert.doesNotMatch(body, /RETURN 'old'/);
});

test('PostgreSQL integer aliases replace the same effective function', () => {
  const body = latestFunctionBody('private.fixture(integer)', [
    "CREATE FUNCTION private.fixture(integer) RETURNS text AS $$ BEGIN RETURN 'old'; END; $$;",
    "CREATE OR REPLACE FUNCTION private.fixture(int4) RETURNS text AS $$ BEGIN RETURN 'new'; END; $$;",
  ]);

  assert.match(body, /RETURN 'new'/);
  assert.doesNotMatch(body, /RETURN 'old'/);
});

test('PostgreSQL decimal aliases replace numeric function arguments', () => {
  const body = latestFunctionBody('private.fixture(numeric)', [
    "CREATE FUNCTION private.fixture(numeric) RETURNS text AS $$ BEGIN RETURN 'old'; END; $$;",
    "CREATE OR REPLACE FUNCTION private.fixture(decimal) RETURNS text AS $$ BEGIN RETURN 'new'; END; $$;",
  ]);

  assert.match(body, /RETURN 'new'/);
  assert.doesNotMatch(body, /RETURN 'old'/);
});

test('resolves the requested overload instead of the last sibling', () => {
  const body = latestFunctionBody('private.fixture(integer)', [
    "CREATE FUNCTION private.fixture(integer) RETURNS text AS $$ BEGIN RETURN 'target'; END; $$;",
    "CREATE FUNCTION private.fixture(text) RETURNS text AS $$ BEGIN RETURN 'sibling'; END; $$;",
  ]);

  assert.match(body, /RETURN 'target'/);
  assert.doesNotMatch(body, /RETURN 'sibling'/);
});

test('does not confuse quoted uppercase siblings with unquoted functions', () => {
  const body = latestFunctionBody('private.fixture(uuid)', [
    "CREATE FUNCTION private.fixture(uuid) RETURNS text AS $$ BEGIN RETURN 'safe'; END; $$;",
    'CREATE FUNCTION private."FIXTURE"(uuid) RETURNS text AS $$ BEGIN RETURN \'sibling\'; END; $$;',
  ]);
  assert.match(body, /RETURN 'safe'/);
  assert.doesNotMatch(body, /RETURN 'sibling'/);
});

test('does not count OUT-only parameters as function inputs', () => {
  const body = latestFunctionBody('private.fixture(uuid)', [
    "CREATE FUNCTION private.fixture(uuid) RETURNS text AS $$ BEGIN RETURN 'input'; END; $$;",
    'CREATE FUNCTION private.fixture(OUT result uuid) RETURNS uuid AS $$ BEGIN result := null; END; $$;',
  ]);
  assert.match(body, /RETURN 'input'/);
  assert.doesNotMatch(body, /result := null/);
});
