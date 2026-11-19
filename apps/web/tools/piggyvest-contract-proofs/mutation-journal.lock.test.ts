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

  it('fails closed on a stale lock: no automatic reclamation, an operator message instead', () => {
    const file = tempFile();
    writeFileSync(`${file}.lock`, '2147483646\n');
    let message = '';
    try {
      createFileJournal(file);
    } catch (error) {
      message =
        error instanceof HarnessRefusal ? error.message : 'NOT_A_REFUSAL';
    }
    expect(message).toContain('JOURNAL_LOCKED');
    expect(message).toMatch(/remove/i);
    expect(message).toContain(path.basename(`${file}.lock`));
    expect(message).toMatch(/no run is active/i);
    // The lock is left exactly as found: nothing deleted, nothing rewritten.
    expect(readFileSync(`${file}.lock`, 'utf8')).toBe('2147483646\n');
  });

  it('two concurrent acquirers against a stale lock: none proceeds and the lock is untouched', async () => {
    const file = tempFile();
    writeFileSync(`${file}.lock`, '2147483646\n');
    const attempts = await Promise.allSettled(
      [1, 2].map(async () => createFileJournal(file))
    );
    const winners = attempts.filter((result) => result.status === 'fulfilled');
    expect(winners).toHaveLength(0);
    for (const result of attempts) {
      expect(result.status).toBe('rejected');
      expect((result as PromiseRejectedResult).reason).toMatchObject({
        code: 'JOURNAL_LOCKED',
      });
    }
    expect(readFileSync(`${file}.lock`, 'utf8')).toBe('2147483646\n');
  });

  it('with no lock present, exactly one of two concurrent acquirers proceeds', async () => {
    const file = tempFile();
    const attempts = await Promise.allSettled(
      [1, 2].map(async () => createFileJournal(file))
    );
    const winners = attempts.filter((result) => result.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    (
      winners[0] as PromiseFulfilledResult<ReturnType<typeof createFileJournal>>
    ).value.release?.();
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
