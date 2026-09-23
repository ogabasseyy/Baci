import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('GIGL quote economics migration', () => {
  it('adds nullable bounded economics columns without grants', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20260901190000_add_gigl_quote_economics.sql'
      ),
      'utf8'
    );
    expect(sql).toMatch(/provider_cost numeric\(12,2\)/);
    expect(sql).toMatch(/platform_margin numeric\(12,2\)/);
    expect(sql).toMatch(/platform_margin_bps integer/);
    expect(sql).toMatch(/pricing_version text/);
    expect(sql).toMatch(/provider_cost IS NULL OR provider_cost >= 0/);
    expect(sql).not.toMatch(/GRANT/i);
  });
});
