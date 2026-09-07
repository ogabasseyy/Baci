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

describe('drop legacy inference and release reserved migration', () => {
  it('removes payment-time legacy inference and defaults missing provider settings', () => {
    expect(sql).not.toContain('v_legacy_checkout');
    expect(sql).toContain(
      "v_pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'"
    );
    expect(sql).toContain('["gigl", "topship"]');
    expect(sql).toContain('fs.shipping_providers IS NOT NULL');
    expect(sql).toContain(
      'release_reserved_merchant_shipping_charges_for_order'
    );
  });
});
