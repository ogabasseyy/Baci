import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260809182751_blog_post_ownership_scope_invariance.sql'
);

describe('blog post ownership scope invariance migration contract', () => {
  it('prevents dual-role users from moving posts across ownership scopes', async () => {
    const migration = await readFile(migrationPath, 'utf8');

    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.enforce_blog_post_ownership_scope_invariance_v1()'
    );
    expect(migration).toContain(
      'OLD.merchant_id IS DISTINCT FROM NEW.merchant_id'
    );
    expect(migration).toContain(
      '(OLD.is_platform_post IS TRUE) IS DISTINCT FROM (NEW.is_platform_post IS TRUE)'
    );
    expect(migration).toContain(
      "RAISE EXCEPTION 'blog_post_ownership_scope_immutable'"
    );
    expect(migration).toContain("USING ERRCODE = '42501'");
  });

  it('runs before every ownership-scope update instead of relying on OR-combined RLS policies', async () => {
    const migration = await readFile(migrationPath, 'utf8');

    expect(migration).toContain(
      'CREATE TRIGGER enforce_blog_post_ownership_scope_invariance_v1'
    );
    expect(migration).toContain(
      'BEFORE UPDATE OF merchant_id, is_platform_post ON public.blog_posts'
    );
    expect(migration).toContain('FOR EACH ROW');
    expect(migration).toContain(
      'EXECUTE FUNCTION public.enforce_blog_post_ownership_scope_invariance_v1()'
    );
    expect(migration).not.toContain('SECURITY DEFINER');
  });
});
