import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createFileJournal,
  createMemoryJournal,
  type JournalEntry,
  newReference,
  referenceInUse,
  slotState,
} from './mutation-journal';
import { HarnessRefusal } from './safety-guards';

const base: JournalEntry = {
  v: 1,
  ts: '2026-10-30T10:00:00.000Z',
  runId: 'run1',
  phase: 'intent',
  slot: 'p2/w2w',
  attempt: 1,
  op: 'wallet_transfer',
  reference: 'pvbproof-run1-wallet_transfer-aaaa1111',
  qaKey: 'qa-customer-1',
  amountKobo: 100_000,
};

function code(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HarnessRefusal ? error.code : 'NOT_A_REFUSAL';
  }
}

describe('slotState', () => {
  it('is fresh when the slot was never used', () => {
    expect(
      slotState(createMemoryJournal(), 'p2/w2w', 1, 'qa-customer-1')
    ).toEqual({
      kind: 'fresh',
    });
  });

  it('treats an intent without an outcome as unresolved, never fresh', () => {
    const journal = createMemoryJournal([base]);
    expect(slotState(journal, 'p2/w2w', 1, 'qa-customer-1')).toEqual({
      kind: 'executed',
      reference: base.reference,
      outcome: 'unresolved',
    });
  });

  it.each([
    'accepted',
    'rejected',
    'indeterminate',
  ] as const)('treats a %s outcome as executed (a re-run must not resend)', (outcome) => {
    const journal = createMemoryJournal([
      base,
      { ...base, phase: 'outcome', outcome, httpStatus: 202 },
    ]);
    expect(slotState(journal, 'p2/w2w', 1, 'qa-customer-1')).toMatchObject({
      kind: 'executed',
      outcome,
    });
  });

  it('allows a retry only when the request provably never left (not_sent)', () => {
    const journal = createMemoryJournal([
      base,
      { ...base, phase: 'outcome', outcome: 'not_sent', httpStatus: null },
    ]);
    expect(slotState(journal, 'p2/w2w', 1, 'qa-customer-1')).toEqual({
      kind: 'fresh',
    });
  });

  it('scopes slots to the QA key, so another QA customer is never resumed from this one', () => {
    const journal = createMemoryJournal([base]);
    expect(slotState(journal, 'p2/w2w', 1, 'qa-customer-2')).toEqual({
      kind: 'fresh',
    });
    expect(slotState(journal, 'p2/w2w', 1, 'qa-customer-1').kind).toBe(
      'executed'
    );
  });

  it('a new attempt number opens a new slot without touching the old one', () => {
    const journal = createMemoryJournal([base]);
    expect(slotState(journal, 'p2/w2w', 2, 'qa-customer-1')).toEqual({
      kind: 'fresh',
    });
    expect(slotState(journal, 'p2/w2w', 1, 'qa-customer-1').kind).toBe(
      'executed'
    );
  });
});

describe('references', () => {
  it('generates unique references and never reuses a journaled one', () => {
    const journal = createMemoryJournal([base]);
    const fixed = () => 'aaaa1111';
    const seq = ['aaaa1111', 'bbbb2222'];
    const reference = newReference(journal, 'wallet_transfer', 'run1', () => {
      return seq.shift() ?? fixed();
    });
    expect(reference).toBe('pvbproof-run1-wallet_transfer-bbbb2222');
    expect(referenceInUse(journal, base.reference)).toBe(true);
    expect(referenceInUse(journal, reference)).toBe(false);
  });

  it('refuses to mint when randomness keeps colliding', () => {
    const journal = createMemoryJournal([base]);
    expect(
      code(() =>
        newReference(journal, 'wallet_transfer', 'run1', () => 'aaaa1111')
      )
    ).toBe('REFERENCE_REUSE');
  });

  it('keeps references provider-safe (short, no spaces)', () => {
    const reference = newReference(
      createMemoryJournal(),
      'bank_transfer',
      'r',
      () => 'cafef00d'
    );
    expect(reference).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
  });
});

describe('createFileJournal', () => {
  function tempPath(): string {
    return path.join(
      mkdtempSync(path.join(tmpdir(), 'pvb-journal-')),
      'sub',
      'j.jsonl'
    );
  }

  it('persists entries as JSONL with private permissions and reloads them', () => {
    const file = tempPath();
    const first = createFileJournal(file);
    first.append(base);
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    first.release?.();
    const second = createFileJournal(file);
    expect(second.entries()).toEqual([base]);
    expect(slotState(second, 'p2/w2w', 1, 'qa-customer-1').kind).toBe(
      'executed'
    );
  });

  it('refuses a corrupt journal rather than guessing', () => {
    const file = tempPath();
    const writer = createFileJournal(file);
    writer.append(base);
    writer.release?.();
    writeFileSync(file, `${readFileSync(file, 'utf8')}{not json}\n`);
    expect(code(() => createFileJournal(file))).toBe('JOURNAL_CORRUPT');
  });

  it('refuses entries that smuggle extra fields (no ids or secrets in the journal)', () => {
    const file = tempPath();
    const writer = createFileJournal(file);
    writer.append(base);
    writer.release?.();
    writeFileSync(
      file,
      `${JSON.stringify({ ...base, walletId: 'secret-wallet-id' })}\n`
    );
    expect(code(() => createFileJournal(file))).toBe('JOURNAL_CORRUPT');
  });

  it('turns a write failure into a refusal so nothing is sent', () => {
    expect(
      code(() => createFileJournal('/dev/null/cannot/write.jsonl').append(base))
    ).toBe('JOURNAL_WRITE_FAILED');
  });
});

describe('createFileJournal: oversized fields', () => {
  it('turns an entry that breaks the journal schema into a refusal, never a raw error', () => {
    const file = path.join(
      mkdtempSync(path.join(tmpdir(), 'pvb-journal-')),
      'j.jsonl'
    );
    const journal = createFileJournal(file);
    expect(code(() => journal.append({ ...base, qaKey: 'q'.repeat(65) }))).toBe(
      'JOURNAL_WRITE_FAILED'
    );
  });
});
