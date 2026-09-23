import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260904082000_exclude_cancelled_settlements_from_gigl_retention.sql'
  ),
  'utf8'
);

describe('exclude cancelled settlements gigl retention migration', () => {
  it('excludes cancelled settlements from cumulative retention reads', () => {
    expect(sql).toContain('record_merchant_settlement_gigl_v1');
    expect(sql).toContain('v_already_retained');
    expect(sql).toContain("settlement.status IS DISTINCT FROM 'cancelled'");
    expect(sql).toContain('pg_catalog.pg_advisory_xact_lock');
  });
});
