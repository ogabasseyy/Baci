import { describe, expect, it } from 'vitest';
import {
  code,
  execute,
  makeGate,
  transfer,
} from './mutation-gate.test-support';
import type { Journal } from './mutation-journal';
import { HarnessRefusal } from './safety-guards';

describe('MutationGate.begin', () => {
  it('writes the intent to the journal BEFORE anything can be sent', () => {
    const { gate, journal } = makeGate();
    const begun = gate.begin(transfer());
    expect(begun.kind).toBe('send');
    expect(journal.entries()).toHaveLength(1);
    expect(journal.entries()[0]).toMatchObject({
      phase: 'intent',
      slot: 'p2/w2w',
      attempt: 1,
      amountKobo: 100_000,
    });
  });

  it('does not send when the intent cannot be journaled', () => {
    const failing: Journal = {
      entries: () => [],
      append: () => {
        throw new HarnessRefusal('JOURNAL_WRITE_FAILED');
      },
    };
    const { gate } = makeGate({ journal: failing });
    expect(code(() => gate.begin(transfer()))).toBe('JOURNAL_WRITE_FAILED');
  });

  it('refuses mutations in live-readonly and allows them elsewhere', () => {
    expect(
      code(() => makeGate({ mode: 'live-readonly' }).gate.begin(transfer()))
    ).toBe('MUTATION_IN_READONLY');
    expect(
      code(() => makeGate({ mode: 'dry-run' }).gate.begin(transfer()))
    ).toBeNull();
  });

  it('refuses wallets that do not belong to an allowlisted QA customer', () => {
    const { gate } = makeGate();
    expect(
      code(() =>
        gate.begin(
          transfer({ walletIds: ['qa-wallet-main', 'house-collection-wallet'] })
        )
      )
    ).toBe('WALLET_NOT_AUTHORIZED');
  });

  it('enforces the per-call and per-run amount caps', () => {
    const { gate } = makeGate();
    expect(code(() => gate.begin(transfer({ amountKobo: 2_000_001 })))).toBe(
      'AMOUNT_CAP'
    );
    expect(code(() => gate.begin(transfer({ amountKobo: 0 })))).toBe(
      'AMOUNT_CAP'
    );
    expect(code(() => gate.begin(transfer({ amountKobo: 1.5 })))).toBe(
      'AMOUNT_CAP'
    );
    const total = makeGate().gate;
    for (let i = 0; i < 3; i += 1) {
      execute(total, transfer({ slot: `s/${i}`, amountKobo: 2_000_000 }));
    }
    expect(
      code(() => total.begin(transfer({ slot: 's/4', amountKobo: 1 })))
    ).toBe('AMOUNT_CAP');
  });

  it('refuses anything that mentions the recording account', () => {
    const { gate } = makeGate();
    expect(
      code(() =>
        gate.begin(
          transfer({
            bodyMatch: {
              source: 'qa-wallet-main',
              note: 'baci-recording-20261013@example.com',
            },
          })
        )
      )
    ).toBe('RECORDING_ACCOUNT');
  });

  it('resumes an executed slot instead of resending (re-run safety)', () => {
    const { gate, journal } = makeGate();
    const first = execute(gate, transfer());
    const entriesBefore = journal.entries().length;

    const rerun = makeGate({ journal, runId: 'run2' }).gate.begin(transfer());
    expect(rerun).toEqual({
      kind: 'resume',
      reference: first.reference,
      outcome: 'accepted',
    });
    expect(journal.entries()).toHaveLength(entriesBefore);
  });

  it('resumes (never resends) an unresolved intent from a crashed run', () => {
    const { gate, journal } = makeGate();
    gate.begin(transfer());
    const rerun = makeGate({ journal, runId: 'run2' }).gate.begin(transfer());
    expect(rerun).toMatchObject({ kind: 'resume', outcome: 'unresolved' });
  });

  it('opens a new slot only for an explicit new attempt', () => {
    const { gate, journal } = makeGate();
    gate.begin(transfer());
    const next = makeGate({ journal, attempt: 2, runId: 'run2' }).gate.begin(
      transfer()
    );
    expect(next.kind).toBe('send');
    if (next.kind === 'send') {
      expect(journal.entries().at(-1)).toMatchObject({ attempt: 2 });
    }
  });
});
