import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryDynamicDdl } from './serialized_variant_inventory_concurrency_contract_dynamic_ddl.mjs';

const { hasDynamicFunctionDdl } = serializedInventoryDynamicDdl;

test('detects function DDL assigned with equals-form operators', () => {
  const source = `DO $wrapper$
DECLARE
  v_sql text;
BEGIN
  v_sql = 'CREATE OR REPLACE FUNCTION private.confirm_order_inventory_reservations(uuid, uuid) RETURNS void AS $body$ BEGIN NULL; END; $body$';
  EXECUTE v_sql;
END;
$wrapper$;`;

  assert.equal(
    hasDynamicFunctionDdl(
      source,
      'private.confirm_order_inventory_reservations(uuid, uuid)'
    ),
    true
  );

  const benign = source.replace(
    `'CREATE OR REPLACE FUNCTION private.confirm_order_inventory_reservations(uuid, uuid) RETURNS void AS $body$ BEGIN NULL; END; $body$'`,
    `'SELECT 1'`
  );
  assert.equal(
    hasDynamicFunctionDdl(
      benign,
      'private.confirm_order_inventory_reservations(uuid, uuid)'
    ),
    false
  );

  const comparison = `DO $wrapper$
DECLARE
  v_sql text;
BEGIN
  IF v_sql = 'CREATE OR REPLACE FUNCTION private.confirm_order_inventory_reservations(uuid, uuid)' THEN NULL; END IF;
  EXECUTE v_sql;
END;
$wrapper$;`;
  assert.equal(
    hasDynamicFunctionDdl(
      comparison,
      'private.confirm_order_inventory_reservations(uuid, uuid)'
    ),
    false
  );
});

test('resolves dynamic DDL hidden in a non-final branch assignment', () => {
  const source = `DO $wrapper$
DECLARE
  v_sql text;
BEGIN
  IF TRUE THEN v_sql := 'CREATE OR REPLACE FUNCTION private.confirm_order_inventory_reservations(uuid, uuid) RETURNS void AS $body$ BEGIN NULL; END; $body$'; ELSE v_sql := 'SELECT 1'; END IF;
  EXECUTE v_sql;
END;
$wrapper$;`;

  assert.equal(
    hasDynamicFunctionDdl(
      source,
      'private.confirm_order_inventory_reservations(uuid, uuid)'
    ),
    true
  );
});

test('treats unresolved format commands on protected functions as DDL', () => {
  const source = `DO $wrapper$
DECLARE
  v_command text := 'CREATE OR REPLACE';
BEGIN
  EXECUTE format('%s FUNCTION private.confirm_order_inventory_reservations(uuid, uuid) RETURNS void AS $body$ BEGIN NULL; END; $body$', v_command);
END;
$wrapper$;`;

  assert.equal(
    hasDynamicFunctionDdl(
      source,
      'private.confirm_order_inventory_reservations(uuid, uuid)'
    ),
    true
  );
});
