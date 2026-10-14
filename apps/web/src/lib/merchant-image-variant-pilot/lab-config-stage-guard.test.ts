import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertNoUnexpectedStagedFiles,
  resolveAllowlist,
} from './lab-config-stage-guard';

const GEN = 'a'.repeat(64);

async function stageTree() {
  const pilotStage = await mkdtemp(join(tmpdir(), 'pilot-reconcile-'));
  await mkdir(join(pilotStage, GEN), { recursive: true });
  await mkdir(join(pilotStage, 'originals'), { recursive: true });
  await mkdir(join(pilotStage, 'fillers'), { recursive: true });
  return pilotStage;
}

describe('assertNoUnexpectedStagedFiles', () => {
  const staged = (pilotStage: string) => [
    { path: join(pilotStage, GEN, 'tier-w800.avif') },
    { path: join(pilotStage, 'originals', 'merchant.png') },
  ];

  async function seedExpected(pilotStage: string) {
    await writeFile(join(pilotStage, GEN, 'tier-w800.avif'), 'tier');
    await writeFile(join(pilotStage, 'originals', 'merchant.png'), 'orig');
  }

  it('accepts exactly the allowlisted staged files', async () => {
    const pilotStage = await stageTree();
    await seedExpected(pilotStage);
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).resolves.toBe(undefined);
  });

  it('rejects regular files planted after staging', async () => {
    const pilotStage = await stageTree();
    await seedExpected(pilotStage);
    await writeFile(join(pilotStage, 'originals', 'planted.png'), 'evil');
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).rejects.toThrow(/has no inventory binding/);
  });

  it('rejects plants inside current generations', async () => {
    const pilotStage = await stageTree();
    await seedExpected(pilotStage);
    await writeFile(join(pilotStage, GEN, 'planted.avif'), 'evil');
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).rejects.toThrow(/has no inventory binding/);
  });

  it('rejects generation dirs with no current binding', async () => {
    // A stale, restored, or planted generation has no stagedPaths
    // entries, so the per-file traversal never visits it — but the
    // startup guard serves every 64-hex directory. The top-level
    // enumeration closes that gap with the re-stage fix.
    const pilotStage = await stageTree();
    await seedExpected(pilotStage);
    const stale = join(pilotStage, 'b'.repeat(64));
    await mkdir(stale, { recursive: true });
    await writeFile(join(stale, 'old.avif'), 'stale');
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).rejects.toThrow(/unreferenced generation directory/);
  });

  it('rejects nested dirs, links, and special files', async () => {
    const pilotStage = await stageTree();
    await seedExpected(pilotStage);
    await mkdir(join(pilotStage, 'originals', 'nested'), { recursive: true });
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).rejects.toThrow(/unexpected staged directory/);
  });

  it('rejects a symlink planted in originals', async () => {
    const pilotStage = await stageTree();
    await seedExpected(pilotStage);
    await symlink(
      join(pilotStage, 'originals', 'merchant.png'),
      join(pilotStage, 'originals', 'link.png')
    );
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).rejects.toThrow(/not a regular file/);
  });

  it('rejects staged content under an empty binding set', async () => {
    // With zero allowlist entries the root cannot derive from staged
    // paths — but callers pass their known root, and any generation
    // or originals content there is unbound by definition.
    const pilotStage = await stageTree();
    const gen = join(pilotStage, 'c'.repeat(64));
    await mkdir(gen, { recursive: true });
    await writeFile(join(gen, 'evil.svg'), '<svg/>');
    await expect(assertNoUnexpectedStagedFiles([], pilotStage)).rejects.toThrow(
      /empty binding set/
    );
  });

  it('refuses a fourth file planted under fillers when bound', async () => {
    // The byte verifier hashes only the pinned filler paths, so the
    // binding check must enumerate the directory: an extra file would
    // otherwise stay publicly reachable while every render passes.
    const pilotStage = await stageTree();
    await seedExpected(pilotStage);
    const pinned = join(pilotStage, 'fillers', 'grid-filler-600x400-a.png');
    await writeFile(pinned, 'filler');
    await writeFile(join(pilotStage, 'fillers', 'planted.png'), 'evil');
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage), pilotStage, [pinned])
    ).rejects.toThrow(/has no inventory binding/);
    // Pinned-only fillers pass: the planted file was the refusal.
    await rm(join(pilotStage, 'fillers', 'planted.png'));
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage), pilotStage, [pinned])
    ).resolves.toBe(undefined);
  });

  it('refuses root-level and non-hex plants after a clean first scan', async () => {
    // The per-request guard must enumerate the stage root itself, not
    // just the known subdirs: a root file or a new non-hex directory
    // planted after boot would otherwise never be visited while Next
    // serves public/__pilot/... statically. The fingerprint carries
    // the root listing so the plant invalidates the fast path.
    const pilotStage = await stageTree();
    await seedExpected(pilotStage);
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).resolves.toBe(undefined);
    await writeFile(join(pilotStage, 'evil.png'), 'evil');
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).rejects.toThrow(/staged entry "evil\.png" has no inventory binding/);
    await rm(join(pilotStage, 'evil.png'));
    await mkdir(join(pilotStage, 'misc'), { recursive: true });
    await writeFile(join(pilotStage, 'misc', 'evil.png'), 'evil');
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).rejects.toThrow(/staged entry "misc" has no inventory binding/);
    await rm(join(pilotStage, 'misc'), { recursive: true });
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).resolves.toBe(undefined);
  });

  it('refuses root-level files with an empty binding set', async () => {
    const pilotStage = await stageTree();
    await writeFile(join(pilotStage, 'evil.png'), 'evil');
    await expect(assertNoUnexpectedStagedFiles([], pilotStage)).rejects.toThrow(
      /staged file "evil\.png" with an empty binding set/
    );
  });

  it('re-scans the same tree after drift but skips when clean', async () => {
    // The drift gate skips repeat walks while the tree is unchanged
    // (per-request verification stays on stats, not listings), but a
    // plant between two scans on the same root must still throw.
    const pilotStage = await stageTree();
    await seedExpected(pilotStage);
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).resolves.toBe(undefined);
    // Second scan, no drift: same verdict via the fingerprint gate.
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).resolves.toBe(undefined);
    // Drift between scans: the gate misses and the full walk throws.
    await writeFile(join(pilotStage, GEN, 'planted.avif'), 'evil');
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).rejects.toThrow(/has no inventory binding/);
    // Failures never record: removing the plant passes again.
    await rm(join(pilotStage, GEN, 'planted.avif'));
    await expect(
      assertNoUnexpectedStagedFiles(staged(pilotStage))
    ).resolves.toBe(undefined);
  });

  it('resolves the allowlist once per stagedPaths identity', async () => {
    // Fast-path pin: the frozen runtime passes the same array every
    // request, so repeat requests must reuse the resolved verdict
    // object (no re-resolution, straight to the fingerprint) — while a
    // fresh array (new config load) re-resolves to an equal verdict.
    const pilotStage = await stageTree();
    await seedExpected(pilotStage);
    const allowlist = staged(pilotStage);
    const first = await resolveAllowlist(allowlist, undefined);
    expect(first).not.toBe(null);
    await expect(assertNoUnexpectedStagedFiles(allowlist)).resolves.toBe(
      undefined
    );
    await expect(resolveAllowlist(allowlist, undefined)).resolves.toBe(first);
    const reloaded = await resolveAllowlist(staged(pilotStage), undefined);
    expect(reloaded).not.toBe(first);
    expect(reloaded).toEqual(first);
  });

  it('accepts a clean tree under an empty binding set', async () => {
    const pilotStage = await stageTree();
    await writeFile(join(pilotStage, 'fillers', 'a.png'), 'committed');
    // Empty managed dirs and committed fillers bind nothing and serve
    // nothing unbound.
    await expect(assertNoUnexpectedStagedFiles([], pilotStage)).resolves.toBe(
      undefined
    );
    // Without a known root there is nothing to enumerate.
    await expect(assertNoUnexpectedStagedFiles([])).resolves.toBe(undefined);
  });

  it('aborts when a staged directory cannot be listed', async () => {
    // Searchable-but-unreadable originals still serves known
    // pathnames: the guard must abort, not accept-and-cache an
    // empty scan that discovered nothing. POSIX-only.
    if (process.platform === 'win32') {
      return;
    }
    const pilotStage = await stageTree();
    await seedExpected(pilotStage);
    const originals = join(pilotStage, 'originals');
    await chmod(originals, 0o111);
    try {
      await expect(
        assertNoUnexpectedStagedFiles(staged(pilotStage))
      ).rejects.toThrow(/cannot list staged directory/);
    } finally {
      await chmod(originals, 0o755);
    }
  });
});
