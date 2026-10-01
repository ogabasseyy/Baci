import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903215500_drop_legacy_inference_and_release_reserved.sql'
  ),
  'utf8'
);

describe('storefront shipping provider defaults after legacy inference drop', () => {
  it('bugfix: coalesces missing/null shipping_providers to GIGL+Topship, not []', () => {
    const ratesFn = sql.slice(
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION public.get_storefront_shipping_rates('
      )
    );
    expect(ratesFn).toContain("'shipping_providers'");
    expect(ratesFn).toContain('\'["gigl", "topship"]\'::jsonb');
    expect(ratesFn).toContain('AND fs.shipping_providers IS NOT NULL');
    expect(ratesFn).not.toMatch(
      /'shipping_providers',\s*COALESCE\(\(\s*SELECT fs\.shipping_providers[\s\S]*?\),\s*'\[\]'::jsonb\)/
    );
  });
});
