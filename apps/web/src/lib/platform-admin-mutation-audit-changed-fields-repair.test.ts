import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260811140001_repair_platform_notification_audit_changed_fields.sql'
);

describe('notification audit changed-fields repair migration', () => {
  it('records safe names for content and targeting edits without values', async () => {
    const migration = await readFile(migrationPath, 'utf8');

    for (const field of [
      'title',
      'message',
      'action_label',
      'action_url',
      'target_segment',
      'target_merchant_ids',
    ]) {
      expect(migration).toContain(`THEN '${field}'`);
    }
    expect(migration).not.toContain("'NEW.title'");
    expect(migration).not.toContain("'NEW.message'");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
  });
});
