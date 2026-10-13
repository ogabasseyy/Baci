import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260830170000_preserve_transaction_discount_marker_on_attribution_update.sql'
  ),
  'utf8'
);

describe('transaction discount marker preservation migration', () => {
  it('preserves an existing marker when a same-merchant attribution update omits it', () => {
    expect(migrationSql).toMatch(
      /TG_OP = 'UPDATE'[\s\S]*?NEW\.merchant_id IS NOT DISTINCT FROM OLD\.merchant_id[\s\S]*?OLD\.ad_tracking \? 'baci_transaction_discount'/i
    );
    expect(migrationSql).toMatch(
      /NEW\.ad_tracking := \([\s\S]*?v_tracking[\s\S]*?\) \|\| jsonb_build_object\([\s\S]*?'baci_transaction_discount'[\s\S]*?OLD\.ad_tracking -> 'baci_transaction_discount'/i
    );
  });

  it('keeps the guarded admin-edit and proof paths ahead of marker stripping', () => {
    const preservationIndex = migrationSql.indexOf(
      "OLD.ad_tracking -> 'baci_transaction_discount'"
    );
    const adminContextIndex = migrationSql.indexOf(
      'transaction_discount_admin_edit_context'
    );
    const proofValidationIndex = migrationSql.indexOf(
      'IF public.quiz_route_proof_valid('
    );
    const strippingIndex = migrationSql.indexOf(
      "v_tracking - 'baci_transaction_discount'"
    );

    expect(preservationIndex).toBeGreaterThan(-1);
    expect(adminContextIndex).toBeGreaterThan(-1);
    expect(proofValidationIndex).toBeGreaterThan(-1);
    expect(strippingIndex).toBeGreaterThan(-1);
    expect(adminContextIndex).toBeGreaterThan(preservationIndex);
    expect(proofValidationIndex).toBeGreaterThan(adminContextIndex);
    expect(strippingIndex).toBeGreaterThan(proofValidationIndex);
  });
});
