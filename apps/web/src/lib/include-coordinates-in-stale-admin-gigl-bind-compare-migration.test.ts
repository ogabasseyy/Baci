import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260906120500_include_coordinates_in_stale_admin_gigl_bind_compare.sql'
  ),
  'utf8'
);

describe('include coordinates in stale admin GIGL bind compare', () => {
  it('bugfix: compares normalized latitude and longitude before overwriting the order', () => {
    expect(sql).toContain('stale_order_quote_inputs');
    expect(sql).toContain("'latitude'");
    expect(sql).toContain("'longitude'");
    expect(sql).toContain('round(');
    expect(sql.indexOf("'latitude'")).toBeLessThan(
      sql.indexOf('UPDATE public.orders')
    );
    expect(sql.indexOf("'longitude'")).toBeLessThan(
      sql.indexOf('UPDATE public.orders')
    );
  });
});
