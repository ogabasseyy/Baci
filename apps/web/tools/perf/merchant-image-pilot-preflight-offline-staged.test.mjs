import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  acceptanceFor,
  GENERATION,
  manifestFor,
  RECORD,
  sha256,
  tierBytes,
} from './merchant-image-pilot-preflight-offline-output-fixtures.mjs';
import {
  checkBindingStaged,
  collectFillerHashes,
  loadCommittedFillerPins,
} from './merchant-image-pilot-preflight-offline-staged.mjs';

describe('checkBindingStaged', () => {
  it('passes staged copies that hash identically, incl. the original', async () => {
    const bytes = await tierBytes();
    const sha = sha256(bytes);
    const manifest = manifestFor({ bytes: bytes.length, sha });
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-offline-staged-'));
    await mkdir(join(publicDir, '__pilot', GENERATION), { recursive: true });
    await mkdir(join(publicDir, '__pilot', 'originals'), { recursive: true });
    await writeFile(
      join(publicDir, '__pilot', GENERATION, `${sha}.webp`),
      bytes
    );
    const original = Buffer.from('original-bytes');
    await writeFile(
      join(
        publicDir,
        '__pilot',
        'originals',
        '6b5cb8a4-5575-456c-b936-8cdfae30db74-logo-a.png'
      ),
      original
    );
    const checks = [];
    const failures = [];
    const ok = await checkBindingStaged({
      acceptance: acceptanceFor([sha]),
      checks,
      failures,
      manifest,
      name: 'staged-ok',
      options: { publicDir },
      record: { ...RECORD, sha256: sha256(original) },
    });
    expect(ok).toBe(true);
    expect(failures).toEqual([]);
  });

  it('locates the staged original by verified format under a lying filename', async () => {
    // PNG bytes inventoried as photo.jpg: the loader stages a .png
    // original, so the staged check must look for .png too — a
    // correctly staged binding cannot fail on the filename lie.
    const bytes = await tierBytes();
    const sha = sha256(bytes);
    const manifest = manifestFor({ bytes: bytes.length, sha });
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-offline-liename-'));
    await mkdir(join(publicDir, '__pilot', GENERATION), { recursive: true });
    await mkdir(join(publicDir, '__pilot', 'originals'), { recursive: true });
    await writeFile(
      join(publicDir, '__pilot', GENERATION, `${sha}.webp`),
      bytes
    );
    const original = Buffer.from('original-bytes');
    await writeFile(
      join(
        publicDir,
        '__pilot',
        'originals',
        '6b5cb8a4-5575-456c-b936-8cdfae30db74-logo-a.png'
      ),
      original
    );
    const checks = [];
    const failures = [];
    const ok = await checkBindingStaged({
      acceptance: acceptanceFor([sha]),
      checks,
      failures,
      manifest,
      name: 'staged-liename',
      options: { publicDir },
      record: {
        ...RECORD,
        sha256: sha256(original),
        sourcePath: 'snapshots/photo.jpg',
      },
    });
    expect(ok).toBe(true);
    expect(failures).toEqual([]);
  });

  it('rejects oversized staged bytes without allocating the whole file', async () => {
    const bytes = await tierBytes();
    const sha = sha256(bytes);
    const manifest = manifestFor({ bytes: bytes.length, sha });
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-offline-staged-'));
    const stageDir = join(publicDir, '__pilot', GENERATION);
    await mkdir(stageDir, { recursive: true });
    await writeFile(
      join(stageDir, `${sha}.webp`),
      Buffer.concat([bytes, Buffer.alloc(2 * 1024 * 1024)])
    );
    const checks = [];
    const failures = [];
    const ok = await checkBindingStaged({
      acceptance: acceptanceFor([sha]),
      checks,
      failures,
      manifest,
      name: 'staged-huge',
      options: { publicDir },
      record: RECORD,
    });
    expect(ok).toBe(false);
    expect(failures.join('\n')).toMatch(/hash mismatch/);
  });

  it('fails closed on missing or drifted staged bytes', async () => {
    const bytes = await tierBytes();
    const sha = sha256(bytes);
    const manifest = manifestFor({ bytes: bytes.length, sha });
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-offline-staged-'));
    const checks = [];
    const failures = [];
    const ok = await checkBindingStaged({
      acceptance: acceptanceFor([sha]),
      checks,
      failures,
      manifest,
      name: 'staged-missing',
      options: { publicDir },
      record: RECORD,
    });
    expect(ok).toBe(false);
    expect(failures.join('\n')).toMatch(/staged derivative missing/);
  });
});

describe('loadCommittedFillerPins', () => {
  it('parses the three pins the boot gate enforces', async () => {
    const pins = await loadCommittedFillerPins();
    expect(Object.keys(pins).sort()).toEqual([
      'grid-filler-600x400-a.png',
      'grid-filler-600x400-b.png',
      'grid-filler-600x400-c.png',
    ]);
    for (const digest of Object.values(pins)) {
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('collectFillerHashes', () => {
  it('records the committed pin for on-disk bytes that match', async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-offline-fillers-'));
    const dir = join(publicDir, '__pilot', 'fillers');
    await mkdir(dir, { recursive: true });
    const bytes = Buffer.from('filler-bytes');
    const pin = sha256(bytes);
    await writeFile(join(dir, 'grid-filler-600x400-a.png'), bytes);
    const checks = [];
    const failures = [];
    const hashes = await collectFillerHashes({
      checks,
      failures,
      fillerPins: { 'grid-filler-600x400-a.png': pin },
      publicDir,
    });
    expect(hashes).toEqual({
      '/__pilot/fillers/grid-filler-600x400-a.png': pin,
    });
    expect(failures).toEqual([]);
    expect(checks).toContainEqual({ name: 'fillers-pinned', ok: true });
  });

  it('fails a same-name replacement instead of blessing its digest', async () => {
    // A filler swapped after the build/startup check but before preflight:
    // hashing the replacement would record the mutable digest and let
    // the served gate pass the same replacement.
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-offline-fillers-'));
    const dir = join(publicDir, '__pilot', 'fillers');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'grid-filler-600x400-a.png'),
      Buffer.from('replacement-bytes')
    );
    const checks = [];
    const failures = [];
    const hashes = await collectFillerHashes({
      checks,
      failures,
      fillerPins: { 'grid-filler-600x400-a.png': sha256('filler-bytes') },
      publicDir,
    });
    expect(hashes).toEqual({});
    expect(failures.join('\n')).toMatch(/filler hash mismatch/);
  });

  it('fails a filler outside the committed pin set', async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-offline-fillers-'));
    const dir = join(publicDir, '__pilot', 'fillers');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'planted.png'), Buffer.from('x'));
    const checks = [];
    const failures = [];
    const hashes = await collectFillerHashes({
      checks,
      failures,
      fillerPins: { 'grid-filler-600x400-a.png': sha256('filler-bytes') },
      publicDir,
    });
    expect(hashes).toEqual({});
    expect(failures.join('\n')).toMatch(/not in the committed pin set/);
  });

  it('fails closed when the committed pins are unreadable', async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-offline-fillers-'));
    const checks = [];
    const failures = [];
    const hashes = await collectFillerHashes({
      checks,
      failures,
      fillerPins: {},
      publicDir,
    });
    expect(hashes).toEqual({});
    expect(failures.join('\n')).toMatch(/pins are missing or unreadable/);
  });

  it('pins nothing when the fillers dir is absent or planted', async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-offline-fillers-'));
    const pins = { 'grid-filler-600x400-a.png': sha256('filler-bytes') };
    expect(
      await collectFillerHashes({
        checks: [],
        failures: [],
        fillerPins: pins,
        publicDir,
      })
    ).toEqual({});
    const dir = join(publicDir, '__pilot', 'fillers');
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < 65; i += 1) {
      await writeFile(join(dir, `planted-${i}.png`), Buffer.from('x'));
    }
    // Past the entry cap the served filler URLs fail closed instead of
    // trusting a planted directory.
    expect(
      await collectFillerHashes({
        checks: [],
        failures: [],
        fillerPins: pins,
        publicDir,
      })
    ).toEqual({});
  });
});
