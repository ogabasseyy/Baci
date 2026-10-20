import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_PENDING_SOURCES } from './expected-pending-sources.test-support';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const SQUASH_FILENAME =
  '20261020090000_storefront_order_entrypoint_body_squash.sql';

async function readSquashMigration(): Promise<string> {
  return readFile(
    path.join(REPOSITORY_ROOT, 'supabase/migrations', SQUASH_FILENAME),
    'utf8'
  );
}

function guardBlock(sql: string, tag: string): string {
  const start = sql.indexOf(`DO $${tag}$`);
  const end = sql.indexOf(`$${tag}$;`, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe('review fix: order entrypoint body squash migration in pending registry', () => {
  it('includes storefront_order_entrypoint_body_squash in pending sources', () => {
    const repositoryPath =
      'supabase/migrations/20261020090000_storefront_order_entrypoint_body_squash.sql';
    const sha256 =
      '5617c790458491c7ce927ddc4b904edb63b0455eb39a1d497090a9a6025562f3';

    expect(EXPECTED_PENDING_SOURCES).toContainEqual({
      repositoryPath,
      sha256,
    });
    expect(supabaseHistoryReplayManifest.pendingSources).toContainEqual({
      repositoryPath,
      sha256,
    });
  });

  it('pre-image guard fails closed on body, presence, owner, and privilege drift', async () => {
    const pre = guardBlock(await readSquashMigration(), 'squash_guard');
    expect(pre).toContain('storefront_order_squash_pre_image_mismatch');
    expect(pre).toContain('storefront_order_function_not_found');
    expect(pre).toContain('storefront_order_squash_privilege_mismatch');
    // md5(NULL) is NULL and NULL <> const is not true, so each
    // function's not-found check must precede its hash/privilege
    // comparisons (which would otherwise silently pass on NULL).
    for (const name of ['checked', 'unchecked']) {
      const notFound = pre.indexOf(`v_${name}_def IS NULL`);
      expect(notFound).toBeGreaterThanOrEqual(0);
      expect(pre.indexOf(`md5(v_${name}_def)`)).toBeGreaterThan(notFound);
      expect(pre.indexOf(`v_${name}_oid`, notFound)).toBeGreaterThan(notFound);
    }
    // Owner + ACL pin the half of the definition pg_get_functiondef omits.
    expect(pre).toContain("'postgres'");
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect(pre).toContain(`has_function_privilege('${role}'`);
    }
  });

  it('post-image guard mirrors the pre-image checks over installed definitions', async () => {
    const post = guardBlock(await readSquashMigration(), 'squash_post_guard');
    expect(post).toContain('storefront_order_squash_post_image_mismatch');
    expect(post).toContain('storefront_order_function_not_found');
    expect(post).toContain('storefront_order_squash_privilege_mismatch');
    for (const name of ['checked', 'unchecked']) {
      const notFound = post.indexOf(`v_${name}_def IS NULL`);
      expect(notFound).toBeGreaterThanOrEqual(0);
      expect(post.indexOf(`md5(v_${name}_def)`)).toBeGreaterThan(notFound);
      expect(post.indexOf(`v_${name}_oid`, notFound)).toBeGreaterThan(notFound);
    }
  });

  it('pre/post guards pin identical body hashes and identity arguments', async () => {
    const sql = await readSquashMigration();
    const pre = guardBlock(sql, 'squash_guard');
    const post = guardBlock(sql, 'squash_post_guard');
    for (const md5 of [
      'cbb7f92e90a128c1fea05640d616ba09',
      '0ac27900ce2d27f5b8f0c66f78fd2d32',
    ]) {
      expect(pre).toContain(md5);
      expect(post).toContain(md5);
    }
    const identityArgs = sql.match(
      /pg_get_function_identity_arguments\(p\.oid\) =\n\s+'([^']+)'/g
    );
    expect(identityArgs).not.toBeNull();
    expect(identityArgs?.length).toBe(4);
    expect(new Set(identityArgs).size).toBe(1);
  });
});
