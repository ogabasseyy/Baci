import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFileJournal } from './mutation-journal';
import { HarnessRefusal } from './safety-guards';

function code(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HarnessRefusal ? error.code : 'NOT_A_REFUSAL';
  }
}
const tempFile = () =>
  path.join(mkdtempSync(path.join(tmpdir(), 'pvb-lock-')), 'j.jsonl');

describe('createFileJournal: one run per journal', () => {
  it('refuses a second run while the first holds the journal (no concurrent double-send)', () => {
    const file = tempFile();
    const first = createFileJournal(file);
    expect(code(() => createFileJournal(file))).toBe('JOURNAL_LOCKED');
    first.release?.();
  });

  it('records the holder pid in the lock and frees it on release', () => {
    const file = tempFile();
    const journal = createFileJournal(file);
    expect(readFileSync(`${file}.lock`, 'utf8').trim()).toBe(
      String(process.pid)
    );
    journal.release?.();
    expect(existsSync(`${file}.lock`)).toBe(false);
    createFileJournal(file).release?.();
  });

  it('release is idempotent', () => {
    const journal = createFileJournal(tempFile());
    journal.release?.();
    expect(() => journal.release?.()).not.toThrow();
  });

  it('reclaims a lock left by a process that no longer exists', () => {
    const file = tempFile();
    writeFileSync(`${file}.lock`, '2147483646\n');
    const journal = createFileJournal(file);
    expect(readFileSync(`${file}.lock`, 'utf8').trim()).toBe(
      String(process.pid)
    );
    journal.release?.();
  });

  it('fails closed on a lock it cannot interpret', () => {
    const file = tempFile();
    writeFileSync(`${file}.lock`, 'garbage');
    expect(code(() => createFileJournal(file))).toBe('JOURNAL_LOCKED');
  });

  it('releases the lock when the journal itself is corrupt', () => {
    const file = tempFile();
    writeFileSync(file, '{not json}\n');
    expect(code(() => createFileJournal(file))).toBe('JOURNAL_CORRUPT');
    expect(existsSync(`${file}.lock`)).toBe(false);
  });
});
