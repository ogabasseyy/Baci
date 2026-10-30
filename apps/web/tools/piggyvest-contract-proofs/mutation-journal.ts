import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { HarnessRefusal } from './safety-guards';

/**
 * Local, append-only journal of mutation intents and outcomes.
 *
 * The intent is durably written BEFORE a request can be sent. Entries hold
 * no provider ids, balances or secrets: only the harness's own slot name,
 * the generated reference, the opaque QA key and the amount.
 */

export const JOURNAL_OUTCOMES = [
  'accepted',
  'rejected',
  'indeterminate',
  'not_sent',
] as const;
export type JournalOutcome = (typeof JOURNAL_OUTCOMES)[number];

const entrySchema = z.strictObject({
  v: z.literal(1),
  ts: z.string().max(40),
  runId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  phase: z.enum(['intent', 'outcome']),
  slot: z.string().min(1).max(120),
  attempt: z.int().positive().max(99),
  op: z.string().min(1).max(40),
  reference: z.string().regex(/^[A-Za-z0-9_-]{8,200}$/),
  qaKey: z.string().min(1).max(64),
  amountKobo: z.int().nonnegative().nullable(),
  outcome: z.enum(JOURNAL_OUTCOMES).optional(),
  httpStatus: z.int().nullable().optional(),
});
export type JournalEntry = z.infer<typeof entrySchema>;

export interface Journal {
  entries(): readonly JournalEntry[];
  /** Durable before returning; throws JOURNAL_WRITE_FAILED otherwise. */
  append(entry: JournalEntry): void;
  /** File journals hold an exclusive lock for the run; release it when done. */
  release?(): void;
}

export function createMemoryJournal(
  seed: readonly JournalEntry[] = []
): Journal {
  const entries = [...seed];
  return {
    entries: () => entries,
    append: (entry) => {
      entries.push(entry);
    },
  };
}

function parseLines(text: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new HarnessRefusal('JOURNAL_CORRUPT', 'journal line is not JSON');
    }
    const parsed = entrySchema.safeParse(json);
    if (!parsed.success) {
      throw new HarnessRefusal(
        'JOURNAL_CORRUPT',
        'journal line has a bad shape'
      );
    }
    entries.push(parsed.data);
  }
  return entries;
}

/** A lock is stale only if its recorded pid provably no longer exists. */
function lockIsStale(lockPath: string): boolean {
  try {
    const pid = Number(readFileSync(lockPath, 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 0) return false; // unreadable: fail closed
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

/**
 * Two concurrent runs would each load the same journal and each send the
 * same "fresh" slot. An exclusive lock file (holder pid inside) makes the
 * second run refuse before it can send anything.
 */
function acquireLock(filePath: string): () => void {
  const lockPath = `${filePath}.lock`;
  try {
    mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  } catch {
    throw new HarnessRefusal(
      'JOURNAL_WRITE_FAILED',
      'cannot create the mutation journal directory; nothing was sent'
    );
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      try {
        writeSync(fd, `${process.pid}\n`);
      } finally {
        closeSync(fd);
      }
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        process.off('exit', release);
        try {
          unlinkSync(lockPath);
        } catch {
          // already gone
        }
      };
      process.once('exit', release);
      return release;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new HarnessRefusal(
          'JOURNAL_WRITE_FAILED',
          'cannot create the mutation journal lock; nothing was sent'
        );
      }
      if (!lockIsStale(lockPath)) {
        throw new HarnessRefusal(
          'JOURNAL_LOCKED',
          'another run holds the mutation journal (or left an unreadable lock file next to it)'
        );
      }
      try {
        unlinkSync(lockPath);
      } catch {
        // lost the race to another reclaimer: the retry will report it
      }
    }
  }
  throw new HarnessRefusal(
    'JOURNAL_LOCKED',
    'could not take the mutation journal lock'
  );
}

export function createFileJournal(filePath: string): Journal {
  const release = acquireLock(filePath);
  let entries: JournalEntry[];
  try {
    entries = existsSync(filePath)
      ? parseLines(readFileSync(filePath, 'utf8'))
      : [];
  } catch (error) {
    release();
    throw error;
  }
  return {
    entries: () => entries,
    release,
    append(entry) {
      try {
        const line = `${JSON.stringify(entrySchema.parse(entry))}\n`;
        mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
        const fd = openSync(filePath, 'a', 0o600);
        try {
          writeSync(fd, line);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      } catch {
        throw new HarnessRefusal(
          'JOURNAL_WRITE_FAILED',
          'cannot persist the mutation journal; nothing was sent'
        );
      }
      entries.push(entry);
    },
  };
}

export type SlotState =
  | { kind: 'fresh' }
  | {
      kind: 'executed';
      reference: string;
      outcome: Exclude<JournalOutcome, 'not_sent'> | 'unresolved';
    };

/**
 * A slot is "executed" once any request for it may have left the machine.
 * Only a recorded `not_sent` outcome proves it did not.
 */
export function slotState(
  journal: Journal,
  slot: string,
  attempt: number,
  qaKey: string
): SlotState {
  const all = journal.entries();
  const intents = all.filter(
    (entry) =>
      entry.phase === 'intent' &&
      entry.slot === slot &&
      entry.attempt === attempt &&
      entry.qaKey === qaKey
  );
  for (const intent of [...intents].reverse()) {
    const outcome = all.find(
      (entry) =>
        entry.phase === 'outcome' && entry.reference === intent.reference
    );
    if (!outcome?.outcome) {
      return {
        kind: 'executed',
        reference: intent.reference,
        outcome: 'unresolved',
      };
    }
    if (outcome.outcome === 'not_sent') continue;
    return {
      kind: 'executed',
      reference: intent.reference,
      outcome: outcome.outcome,
    };
  }
  return { kind: 'fresh' };
}

export function referenceInUse(journal: Journal, reference: string): boolean {
  return journal.entries().some((entry) => entry.reference === reference);
}

export function newReference(
  journal: Journal,
  op: string,
  runId: string,
  random: () => string = () => randomBytes(4).toString('hex')
): string {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = `pvbproof-${runId}-${op}-${random()}`;
    if (!referenceInUse(journal, reference)) return reference;
  }
  throw new HarnessRefusal(
    'REFERENCE_REUSE',
    'could not mint a unique reference'
  );
}
