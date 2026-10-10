import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { readHostedSavingsInstallBundle } from './hosted-savings-install-bundle';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
test('verifies all reviewed bytes before SQL; refuses tampering and symlink escapes', async () => {
  const root = await mkdtemp('/tmp/hosted-savings-install-test-');
  try {
    await mkdir(path.join(root, 'sql'));
    const sql = 'SELECT 1;';
    const audit = '{}';
    const entries = Array.from({ length: 125 }, (_, index) => ({
      ordinal: index + 1,
      stage: 'bootstrap',
      source: `supabase/migrations/20260914${String(index).padStart(6, '0')}_fixture.sql`,
      sourceSha256: hash(sql),
      transform: null,
      file: `sql/${index + 1}-20260914${String(index).padStart(6, '0')}_fixture.sql`,
      sha256: hash(sql),
      bytes: Buffer.byteLength(sql),
    }));
    const manifest = JSON.stringify({
      format: 1,
      mode: 'materialize-only',
      baseSha: 'a'.repeat(40),
      ordering:
        'existing chronological materializer then existing current-tree replacement applier',
      bootstrapCount: 125,
      inputs: [],
      entries,
      auditSha256: hash(audit),
      executionAuthorized: false,
      resumeSupported: false,
    });
    await writeFile(path.join(root, 'manifest.json'), manifest);
    await writeFile(path.join(root, 'audit.json'), audit);
    for (const entry of entries)
      await writeFile(path.join(root, entry.file), sql);
    assert.equal(
      (await readHostedSavingsInstallBundle(root, hash(manifest))).entries
        .length,
      125
    );
    await assert.rejects(
      readHostedSavingsInstallBundle(root, '0'.repeat(64)),
      /manifest hash/
    );
    await writeFile(path.join(root, entries[124].file), 'SELECT 2;');
    await assert.rejects(
      readHostedSavingsInstallBundle(root, hash(manifest)),
      /SQL bundle hash/
    );
    await rm(path.join(root, entries[124].file));
    await symlink('/etc/hosts', path.join(root, entries[124].file));
    await assert.rejects(
      readHostedSavingsInstallBundle(root, hash(manifest)),
      /Unsafe bundle/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
