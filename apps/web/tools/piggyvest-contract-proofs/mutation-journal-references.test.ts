import { describe, expect, it } from 'vitest';
import { createMemoryJournal, type JournalEntry } from './mutation-journal';
import {
  acceptedReference,
  newReference,
  referenceInUse,
  walletsDigest,
} from './mutation-journal-references';
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
  walletsDigest: walletsDigest(['w1', 'w2']),
};

function code(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HarnessRefusal ? error.code : 'NOT_A_REFUSAL';
  }
}

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

describe('walletsDigest', () => {
  it('is order sensitive, 16 hex characters, and differs per wallet set', () => {
    expect(walletsDigest(['w1', 'w2'])).not.toBe(walletsDigest(['w2', 'w1']));
    expect(walletsDigest(['w1', 'w2'])).toBe(walletsDigest(['w1', 'w2']));
    expect(walletsDigest(['w1', 'w2'])).toMatch(/^[0-9a-f]{16}$/);
    expect(walletsDigest(['w1', 'w2'])).not.toBe(walletsDigest(['w1', 'w3']));
  });
});

describe('acceptedReference', () => {
  const outcome: JournalEntry = {
    ...base,
    phase: 'outcome',
    outcome: 'accepted',
    httpStatus: 200,
  };
  const expected = {
    amountKobo: 100_000,
    walletIds: ['w1', 'w2'],
    slot: 'p2/w2w',
  };

  it('matches only an accepted original with the same amount and wallets', () => {
    const journal = createMemoryJournal([base, outcome]);
    const { reference, qaKey, op } = base;
    expect(acceptedReference(journal, reference, qaKey, op, expected)).toBe(
      true
    );
    expect(
      acceptedReference(journal, reference, qaKey, op, {
        ...expected,
        amountKobo: 200_000,
      })
    ).toBe(false);
    expect(
      acceptedReference(journal, reference, qaKey, op, {
        ...expected,
        walletIds: ['w1', 'w9'],
      })
    ).toBe(false);
    expect(
      acceptedReference(journal, reference, qaKey, op, {
        amountKobo: null,
        walletIds: expected.walletIds,
      })
    ).toBe(false);
  });

  it('refuses the reverse direction and any other original slot', () => {
    const journal = createMemoryJournal([base, outcome]);
    const { reference, qaKey, op } = base;
    expect(
      acceptedReference(journal, reference, qaKey, op, {
        ...expected,
        walletIds: ['w2', 'w1'],
      })
    ).toBe(false);
    expect(
      acceptedReference(journal, reference, qaKey, op, {
        ...expected,
        slot: 'p4/w2w',
      })
    ).toBe(false);
    expect(acceptedReference(journal, reference, qaKey, op, expected)).toBe(
      true
    );
  });

  it('does not match an unfinished or rejected original', () => {
    const { reference, qaKey, op } = base;
    expect(
      acceptedReference(
        createMemoryJournal([base]),
        reference,
        qaKey,
        op,
        expected
      )
    ).toBe(false);
    expect(
      acceptedReference(
        createMemoryJournal([base, { ...outcome, outcome: 'rejected' }]),
        reference,
        qaKey,
        op,
        expected
      )
    ).toBe(false);
  });
});
