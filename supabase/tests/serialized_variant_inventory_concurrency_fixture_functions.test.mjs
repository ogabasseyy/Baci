import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { serializedInventoryFixtureFunctions } from './serialized_variant_inventory_concurrency_fixture_functions.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

test('extracts the current claim and confirmation functions as complete SQL statements', () => {
  const sql = serializedInventoryFixtureFunctions.fixtureFunctionSql(repoRoot);

  assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length, 4);
  assert.match(
    sql,
    /private\.claim_variant_inventory_units_for_order_item_internal[\s\S]*?FOR UPDATE SKIP LOCKED/i
  );
  assert.match(
    sql,
    /private\.confirm_order_inventory_reservations[\s\S]*?ORDER BY oi\.product_id, oi\.id[\s\S]*?FOR UPDATE/i
  );
  assert.match(
    sql,
    /public\.claim_variant_inventory_units_for_order_item[\s\S]*?private\.claim_variant_inventory_units_for_order_item_internal/i
  );
  assert.match(
    sql,
    /public\.confirm_order_inventory_reservations[\s\S]*?private\.confirm_order_inventory_reservations/i
  );
  assert.equal(sql.trimEnd().endsWith(';'), true);
});

test('loads a later migration replacement into the PostgreSQL fixture', () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'serialized-inventory-fixture-')
  );
  const migrationsDir = path.join(tempRoot, 'supabase', 'migrations');
  fs.mkdirSync(migrationsDir, { recursive: true });
  const sourceFiles = [
    '20260615181534_serialized_variant_inventory.sql',
    '20260825173500_authorize_serialized_inventory_claims.sql',
    '20260825180500_authorize_inventory_confirmation.sql',
    '20260829003000_harden_confirmation_reservation_capture.sql',
    '20260830001000_harden_confirmation_partial_reservation_capture.sql',
  ];

  try {
    for (const fileName of sourceFiles) {
      fs.copyFileSync(
        path.join(repoRoot, 'supabase', 'migrations', fileName),
        path.join(migrationsDir, fileName)
      );
    }
    fs.writeFileSync(
      path.join(migrationsDir, '99999999999999_fixture_replacement.sql'),
      `
        CREATE OR REPLACE FUNCTION private.confirm_order_inventory_reservations(
          p_merchant_id uuid,
          p_order_id uuid
        ) RETURNS jsonb
        LANGUAGE plpgsql
        AS $fixture$
        BEGIN
          RETURN jsonb_build_object('fixture_marker', 'latest');
        END;
$fixture$;
      `
    );

    const sql =
      serializedInventoryFixtureFunctions.fixtureFunctionSql(tempRoot);
    assert.match(
      sql,
      /private\.confirm_order_inventory_reservations[\s\S]*fixture_marker.*latest/i
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
