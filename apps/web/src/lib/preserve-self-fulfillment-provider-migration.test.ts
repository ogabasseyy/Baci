import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903215200_preserve_self_fulfillment_provider.sql'
  ),
  'utf8'
);

describe('preserve self-fulfillment provider migration', () => {
  it('keeps checkout economics without forcing GIGL over self-fulfillment', () => {
    expect(sql).toContain("OLD.shipping_funding_source = 'customer_checkout'");
    expect(sql).toContain(
      "COALESCE(NEW.fulfillment_type, '') IS DISTINCT FROM 'self'"
    );
    expect(sql).toContain("NEW.shipping_provider := 'GIGL';");
    expect(sql).toContain(
      'NEW.shipping_platform_retained_amount := OLD.shipping_platform_retained_amount'
    );
  });
});
