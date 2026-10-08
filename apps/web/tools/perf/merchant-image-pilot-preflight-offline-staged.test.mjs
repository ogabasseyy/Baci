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
import { checkBindingStaged } from './merchant-image-pilot-preflight-offline-staged.mjs';

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
