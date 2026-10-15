import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256 } from './merchant-image-pilot-preflight-offline-output-fixtures.mjs';
import { collectFillerHashes } from './merchant-image-pilot-preflight-offline-staged.mjs';

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

  it('fails when the fillers dir is absent or planted', async () => {
    // Fail-closed, never best-effort: every store grid references these
    // images, so an offline-only run must not report ok and defer
    // detection to the optional served gate.
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-offline-fillers-'));
    const pins = { 'grid-filler-600x400-a.png': sha256('filler-bytes') };
    const absentFailures = [];
    expect(
      await collectFillerHashes({
        checks: [],
        failures: absentFailures,
        fillerPins: pins,
        publicDir,
      })
    ).toEqual({});
    expect(absentFailures.join('\n')).toMatch(/missing or unreadable/);
    const dir = join(publicDir, '__pilot', 'fillers');
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < 65; i += 1) {
      await writeFile(join(dir, `planted-${i}.png`), Buffer.from('x'));
    }
    const plantedFailures = [];
    expect(
      await collectFillerHashes({
        checks: [],
        failures: plantedFailures,
        fillerPins: pins,
        publicDir,
      })
    ).toEqual({});
    expect(plantedFailures.join('\n')).toMatch(/past the 64-file cap/);
  });

  it('fails a pinned filler with no file on disk', async () => {
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-offline-fillers-'));
    const dir = join(publicDir, '__pilot', 'fillers');
    await mkdir(dir, { recursive: true });
    const bytes = Buffer.from('filler-bytes');
    await writeFile(join(dir, 'grid-filler-600x400-a.png'), bytes);
    const checks = [];
    const failures = [];
    const hashes = await collectFillerHashes({
      checks,
      failures,
      fillerPins: {
        'grid-filler-600x400-a.png': sha256(bytes),
        'grid-filler-600x400-b.png': sha256('other-bytes'),
      },
      publicDir,
    });
    expect(hashes).toEqual({
      '/__pilot/fillers/grid-filler-600x400-a.png': sha256(bytes),
    });
    expect(failures.join('\n')).toMatch(
      /missing from the staged tree: grid-filler-600x400-b\.png/
    );
  });

  it('fails an unreadable pinned filler without double-reporting it missing', async () => {
    // A directory at the pinned path: readdir lists it but the byte read
    // throws, portably, without chmod games root would bypass.
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-offline-fillers-'));
    const dir = join(publicDir, '__pilot', 'fillers');
    await mkdir(join(dir, 'grid-filler-600x400-a.png'), { recursive: true });
    const checks = [];
    const failures = [];
    const hashes = await collectFillerHashes({
      checks,
      failures,
      fillerPins: { 'grid-filler-600x400-a.png': sha256('filler-bytes') },
      publicDir,
    });
    expect(hashes).toEqual({});
    expect(failures.join('\n')).toMatch(/filler is unreadable/);
    expect(failures.join('\n')).not.toMatch(/missing from the staged tree/);
  });
});
