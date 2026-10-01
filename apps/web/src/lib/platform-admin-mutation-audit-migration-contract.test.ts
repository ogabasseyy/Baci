import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260805150950_platform_admin_mutation_audit_triggers.sql'
);

describe('platform admin mutation audit trigger migration contract', () => {
  it('audits authenticated notification and platform-blog mutations with matching permissions', async () => {
    const migration = await readFile(migrationPath, 'utf8');

    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION private.audit_platform_notification_mutation_v1()'
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION private.audit_platform_blog_post_mutation_v1()'
    );
    expect(migration).toContain("'notifications.manage'");
    expect(migration).toContain("'content.manage'");
    expect(migration).toContain("'notification.created'");
    expect(migration).toContain("'notification.updated'");
    expect(migration).toContain("'notification.deleted'");
    expect(migration).toContain("'platform_blog_post.created'");
    expect(migration).toContain("'platform_blog_post.updated'");
    expect(migration).toContain("'platform_blog_post.deleted'");
    expect(migration).toContain('INSERT INTO public.platform_audit_events');
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('OWNER TO postgres');
  });

  it('is idempotent, keeps the ledger payload privacy-safe, and skips workers without an actor', async () => {
    const migration = await readFile(migrationPath, 'utf8');
    const notificationTrigger = migration.match(
      /CREATE OR REPLACE FUNCTION private\.audit_platform_notification_mutation_v1\(\)[\s\S]*?CREATE TRIGGER audit_platform_notification_mutation_v1/
    )?.[0];
    const blogTrigger = migration.match(
      /CREATE OR REPLACE FUNCTION private\.audit_platform_blog_post_mutation_v1\(\)[\s\S]*?CREATE TRIGGER audit_platform_blog_post_mutation_v1/
    )?.[0];

    expect(notificationTrigger).toBeDefined();
    expect(blogTrigger).toBeDefined();
    expect(migration).toContain(
      'DROP TRIGGER IF EXISTS audit_platform_notification_mutation_v1'
    );
    expect(migration).toContain(
      'DROP TRIGGER IF EXISTS audit_platform_blog_post_mutation_v1'
    );
    expect(migration).toContain('IF v_actor_user_id IS NULL THEN');
    expect(
      notificationTrigger?.indexOf('IF v_actor_user_id IS NULL THEN')
    ).toBeLessThan(
      notificationTrigger?.indexOf("'notifications.manage'") ??
        Number.POSITIVE_INFINITY
    );
    expect(notificationTrigger).toContain('RETURN NEW;');
    expect(notificationTrigger).toContain('RETURN OLD;');
    expect(migration).toContain("'category', 'notifications'");
    expect(migration).toContain("'category', 'content'");
    expect(notificationTrigger).not.toMatch(
      /\b(?:NEW|OLD)\.(?:title|message|target_merchant_ids|action_url|action_label)\b/i
    );
    expect(blogTrigger).not.toMatch(
      /\b(?:NEW|OLD)\.(?:title|content|excerpt|author_name|author_title|author_image_url|author_bio|seo_title|seo_description)\b/i
    );
    expect(`${notificationTrigger}\n${blogTrigger}`).not.toMatch(/recipient/i);
  });

  it('leaves ordinary merchant blog rows outside the platform audit trigger', async () => {
    const migration = await readFile(migrationPath, 'utf8');

    expect(migration).toContain('NEW.is_platform_post IS TRUE');
    expect(migration).toContain('OLD.is_platform_post IS TRUE');
    expect(migration).toContain('NEW.merchant_id IS NULL');
    expect(migration).toContain('OLD.merchant_id IS NULL');
    expect(migration).toContain(
      "IF TG_OP = 'UPDATE' AND NOT (v_old_is_platform_post OR v_new_is_platform_post) THEN"
    );
  });

  it('keeps the migration bounded and ordered between notification hardening and system health', async () => {
    const migration = await readFile(migrationPath, 'utf8');

    expect(migration.split('\n').length).toBeLessThanOrEqual(300);
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
    expect(migrationPath).toContain('20260805150950_');
  });
});
