import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260805151490_platform_content_rbac_bridge.sql'
);
const auditMigrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260805150950_platform_admin_mutation_audit_triggers.sql'
);

describe('platform content RBAC bridge migration contract', () => {
  it('gives only content.manage roles platform-post mutations', async () => {
    const migration = await readFile(migrationPath, 'utf8');

    expect(migration).toContain(
      "public.current_user_has_platform_admin_permission_v1('content.manage')"
    );
    expect(migration).toContain(
      'CREATE POLICY platform_blog_posts_content_manage_insert_v1'
    );
    expect(migration).toContain(
      'CREATE POLICY platform_blog_posts_content_manage_update_v1'
    );
    expect(migration).toContain(
      'CREATE POLICY platform_blog_posts_content_manage_delete_v1'
    );
    expect(migration).toContain('is_platform_post IS TRUE');
    expect(migration).toContain('merchant_id IS NULL');
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Authenticated can insert blog posts"'
    );
    expect(migration).not.toContain('is_platform_admin');
  });

  it('keeps drafts content-only while retaining published platform reads', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    const authenticatedRead = migration.match(
      /CREATE POLICY platform_blog_posts_authenticated_read_v1[\s\S]*?;\n\nCREATE POLICY platform_blog_posts_anon_read_v1/
    )?.[0];
    const anonymousRead = migration.match(
      /CREATE POLICY platform_blog_posts_anon_read_v1[\s\S]*?;\n\nDROP POLICY IF EXISTS "Platform admins can upload/
    )?.[0];

    expect(authenticatedRead).toContain(
      'AS RESTRICTIVE FOR SELECT TO authenticated'
    );
    expect(authenticatedRead).toContain("status = 'published'::text");
    expect(authenticatedRead).toContain('published_at IS NOT NULL');
    expect(authenticatedRead).toContain("permission_v1('content.manage')");
    expect(anonymousRead).toContain('AS RESTRICTIVE FOR SELECT TO anon');
    expect(anonymousRead).toContain("status = 'published'::text");
    expect(anonymousRead).toContain('published_at IS NOT NULL');
    expect(anonymousRead).not.toContain('content.manage');
  });

  it('limits media mutations to the media/platform/blog prefix and content roles', async () => {
    const migration = await readFile(migrationPath, 'utf8');

    for (const operation of ['insert', 'update', 'delete']) {
      expect(migration).toContain(
        `CREATE POLICY platform_blog_media_content_manage_${operation}_v1`
      );
    }
    expect(migration).toContain("bucket_id = 'media'");
    expect(migration).toContain("name LIKE 'platform/blog/%'");
    expect(migration).toContain(
      "public.current_user_has_platform_admin_permission_v1('content.manage')"
    );
    expect(migration).not.toContain(
      'FOR SELECT TO authenticated\n  USING (\n    bucket_id'
    );
  });

  it('keeps content-managed platform mutations covered by the audit trigger', async () => {
    const [migration, auditMigration] = await Promise.all([
      readFile(migrationPath, 'utf8'),
      readFile(auditMigrationPath, 'utf8'),
    ]);

    expect(migration).not.toContain('DROP TRIGGER');
    expect(auditMigration).toContain(
      'CREATE TRIGGER audit_platform_blog_post_mutation_v1'
    );
    expect(auditMigration).toContain("'content.manage'");
    expect(auditMigration).toContain("'platform_blog_post.created'");
    expect(auditMigration).toContain("'platform_blog_post.updated'");
    expect(auditMigration).toContain("'platform_blog_post.deleted'");
  });

  it('is transaction-bounded and leaves merchant policies on merchant rows', async () => {
    const migration = await readFile(migrationPath, 'utf8');

    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
    expect(migration).toContain('CREATE POLICY blog_posts_merchant_insert_v2');
    expect(migration).toContain('merchant_id IS NOT NULL');
    expect(migration.split('\n').length).toBeLessThanOrEqual(300);
  });
});
