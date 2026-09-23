import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903220500_serialize_gigl_settlement_retention.sql'
  ),
  'utf8'
);

describe('serialize gigl settlement retention migration', () => {
  it('serializes cumulative retention reads per order before settlement insert', () => {
    expect(sql).toContain('record_merchant_settlement_gigl_v1');
    expect(sql).toContain('pg_catalog.pg_advisory_xact_lock');
    expect(sql).toContain(
      "pg_catalog.hashtextextended('merchant-shipping-order:' || p_source_id::text, 0)"
    );
    expect(sql).toContain('v_already_retained');
    expect(sql).toContain('record_merchant_settlement(');
  });
});
