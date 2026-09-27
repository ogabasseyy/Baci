import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationSql = [
  '20260912090000_uba_redvault_discount_persistence.sql',
  '20260912090100_uba_redvault_snapshot_binding.sql',
  '20260912090200_uba_redvault_order_draft.sql',
  '20260912090300_uba_redvault_proof_attachment.sql',
]
  .map((filename) =>
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        `../../../../supabase/migrations/${filename}`
      ),
      'utf8'
    )
  )
  .join('\n');

describe('UBA REDVAULT discount persistence migration', () => {
  it('keeps protected state private and disabled until explicit operations enable it', () => {
    expect(migrationSql).toMatch(
      /CREATE TABLE IF NOT EXISTS private\.uba_redvault_runtime/i
    );
    expect(migrationSql).toMatch(/enabled boolean NOT NULL DEFAULT false/i);
    expect(migrationSql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(migrationSql).toMatch(
      /REVOKE ALL ON TABLE private\.uba_redvault_runtime[\s\S]*?FROM PUBLIC, anon, authenticated/i
    );
  });

  it('creates a route-scoped draft before it accepts a separate proof attachment', () => {
    expect(migrationSql).toMatch(
      /FUNCTION public\.create_storefront_redvault_order_draft/i
    );
    expect(migrationSql).toMatch(
      /FUNCTION public\.attach_storefront_redvault_discount_proof/i
    );
    expect(migrationSql).toMatch(/storefront_order_context[\s\S]*?route/i);
    expect(migrationSql).toMatch(
      /status text NOT NULL CHECK \(status IN \('draft', 'pending', 'approved', 'held', 'void'\)\)/i
    );
    expect(migrationSql).toMatch(
      /INSERT INTO private\.redvault_discount_proof_replay/i
    );
  });

  it('does not allow the legacy generic discount redemption path to consume a bound record', () => {
    expect(migrationSql).toMatch(
      /FUNCTION private\.reject_uba_redvault_generic_redemption/i
    );
    expect(migrationSql).toMatch(
      /TRIGGER reject_uba_redvault_generic_redemption/i
    );
    expect(migrationSql).toMatch(
      /RAISE EXCEPTION 'redvault_discount_requires_protected_path'/i
    );
  });
});
