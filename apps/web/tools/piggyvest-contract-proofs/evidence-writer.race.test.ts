import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildEvidence } from './evidence';
import { writeEvidence } from './evidence-writer';
import { Redactor } from './redactor';
import { HarnessRefusal } from './safety-guards';

/**
 * The race: another process creates the file between "is the name free?" and
 * the write. There is no such check any more; the exclusive create itself
 * decides, and a collision moves on to the next suffix. The injected
 * `createFile` plays the racing process.
 */

const collision = () =>
  Object.assign(new Error('file already exists'), { code: 'EEXIST' });
const denied = () =>
  Object.assign(new Error('read-only file system'), { code: 'EROFS' });

const tempDir = () => mkdtempSync(path.join(tmpdir(), 'pvb-race-'));
const doc = () =>
  buildEvidence({
    date: '2026-10-30',
    mode: 'live-readonly',
    mockData: false,
    proofs: [],
  });
const write = (
  dir: string,
  createFile?: (file: string, text: string) => void
) =>
  writeEvidence({
    mode: 'live-readonly',
    doc: doc(),
    redactor: new Redactor(),
    dir,
    createFile,
  });
const exclusive = (file: string, text: string) =>
  writeFileSync(file, text, { flag: 'wx' });

describe('writeEvidence: exclusive create, no check-then-write race', () => {
  it('moves to the next suffix when the markdown name is taken at write time', () => {
    const dir = tempDir();
    let first = true;
    const written = write(dir, (file, text) => {
      if (first) {
        first = false;
        exclusive(file, 'created by someone else in the meantime');
      }
      exclusive(file, text);
    });
    expect(path.basename(written.markdownPath)).toBe('2026-10-30-2.md');
    expect(path.basename(written.jsonPath)).toBe('2026-10-30-2.json');
    expect(readFileSync(path.join(dir, '2026-10-30.md'), 'utf8')).toBe(
      'created by someone else in the meantime'
    );
  });

  it('removes its own markdown and retries when the json name is taken at write time', () => {
    const dir = tempDir();
    let jsonTried = false;
    const written = write(dir, (file, text) => {
      if (file.endsWith('2026-10-30.json') && !jsonTried) {
        jsonTried = true;
        exclusive(file, '{"from":"someone else"}');
      }
      exclusive(file, text);
    });
    expect(path.basename(written.jsonPath)).toBe('2026-10-30-2.json');
    expect(readdirSync(dir).sort()).toEqual([
      '2026-10-30-2.json',
      '2026-10-30-2.md',
      '2026-10-30.json',
    ]);
  });

  it('gives up with a refusal after a bounded number of collisions', () => {
    const dir = tempDir();
    let attempts = 0;
    const alwaysTaken = () => {
      attempts += 1;
      throw collision();
    };
    expect(() => write(dir, alwaysTaken)).toThrow(HarnessRefusal);
    expect(attempts).toBe(100);
    expect(readdirSync(dir)).toEqual([]);
    expect(() => write(dir, alwaysTaken)).toThrow(/no free evidence file name/);
  });

  it('rethrows an error that is not a name collision, leaving nothing behind', () => {
    const dir = tempDir();
    expect(() =>
      write(dir, (file, text) => {
        if (file.endsWith('.json')) throw denied();
        exclusive(file, text);
      })
    ).toThrow(/read-only/);
    expect(readdirSync(dir)).toEqual([]);
    expect(() =>
      write(dir, () => {
        throw denied();
      })
    ).toThrow(/read-only/);
  });

  it('writes a plain first run to the unsuffixed name', () => {
    const dir = tempDir();
    const written = write(dir);
    expect(path.basename(written.markdownPath)).toBe('2026-10-30.md');
    expect(readdirSync(dir).sort()).toEqual([
      '2026-10-30.json',
      '2026-10-30.md',
    ]);
  });
});
