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

test('resolves assigned DDL executed with INTO and USING clauses', () => {
  const source = `DO $wrapper$
DECLARE
  v_sql text;
  v_row record;
BEGIN
  v_sql := 'CREATE OR REPLACE FUNCTION private.confirm_order_inventory_reservations(uuid, uuid) RETURNS void AS $body$ BEGIN NULL; END; $body$';
  EXECUTE v_sql INTO v_row USING 1;
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

test('fails closed on untraced function-definition replacements', () => {
  const source = `DO $wrapper$
DECLARE
  v_oid oid;
  v_definition text;
  v_updated text;
BEGIN
  SELECT function_definition.oid INTO v_oid FROM pg_catalog.pg_proc AS function_definition WHERE function_definition.proname = 'confirm_order_inventory_reservations';
  SELECT pg_catalog.pg_get_functiondef(v_oid) INTO v_definition;
  v_updated := replace(v_definition, 'RAISE EXCEPTION', 'NULL');
  EXECUTE v_updated;
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

test('traces registered order-only definition replacements', () => {
  const source = `DO $wrapper$
DECLARE
  v_oid oid;
  v_definition text;
  v_updated text;
BEGIN
  SELECT function_definition.oid INTO v_oid FROM pg_catalog.pg_proc AS function_definition WHERE function_definition.proname = 'mark_order_inventory_units_sold';
  SELECT pg_catalog.pg_get_functiondef(v_oid) INTO v_definition;
  v_updated := replace(v_definition, 'ORDER BY pv.product_id, vi.id', 'ORDER BY pv.product_id, vi.variant_id, vi.id');
  EXECUTE v_updated;
END;
$wrapper$;`;

  assert.equal(
    hasDynamicFunctionDdl(
      source,
      'private.mark_order_inventory_units_sold(uuid, uuid)'
    ),
    false
  );
});

test('resolves assigned DDL executed through a parenthesized variable', () => {
  const source = `DO $wrapper$
DECLARE
  v_sql text;
BEGIN
  v_sql := 'ALTER FUNCTION private.confirm_order_inventory_reservations(uuid, uuid) OWNER TO mallory';
  EXECUTE (v_sql);
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
