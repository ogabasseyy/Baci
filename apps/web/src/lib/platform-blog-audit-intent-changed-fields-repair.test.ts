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

  it('records focus keyword edits in the follow-up repair', async () => {
    const followUp = await readFile(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20261006123500_repair_platform_blog_audit_focus_changed_fields.sql'
      ),
      'utf8'
    );

    expect(followUp).toContain(
      'CREATE OR REPLACE FUNCTION private.audit_platform_blog_post_mutation_v1()'
    );
    expect(followUp).toContain("THEN 'focus_keyword'");
    expect(followUp).not.toContain("'NEW.focus_keyword'");
  });

  it('records alt-text edits in the alt repair', async () => {
    const altRepair = await readFile(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20261007220000_repair_platform_blog_audit_alt_changed_fields.sql'
      ),
      'utf8'
    );

    expect(altRepair).toContain(
      'CREATE OR REPLACE FUNCTION private.audit_platform_blog_post_mutation_v1()'
    );
    expect(altRepair).toContain("THEN 'featured_image_alt'");
    expect(altRepair).not.toContain("'NEW.featured_image_alt'");
  });
});
