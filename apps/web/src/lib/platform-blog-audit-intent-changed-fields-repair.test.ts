import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20261006123000_repair_platform_blog_audit_intent_changed_fields.sql'
);

describe('platform blog audit intent changed-fields repair migration', () => {
  it('records intent classification and provenance edits without values', async () => {
    const migration = await readFile(migrationPath, 'utf8');

    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION private.audit_platform_blog_post_mutation_v1()'
    );
    for (const field of ['intent', 'intent_source']) {
      expect(migration).toContain(`THEN '${field}'`);
    }
    expect(migration).not.toContain("'NEW.intent'");
    expect(migration).not.toContain("'NEW.intent_source'");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
  });
});
