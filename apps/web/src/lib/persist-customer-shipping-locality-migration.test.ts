import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903220300_persist_customer_shipping_locality.sql`,
  'utf8'
);

describe('persist customer shipping locality migration', () => {
  it('adds structured locality columns on customers', () => {
    expect(sql).toContain('ALTER TABLE public.customers');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS city text');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS state text');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS zip_code text');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS country text');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS country_code text');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS latitude double precision');
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS longitude double precision'
    );
  });
});
