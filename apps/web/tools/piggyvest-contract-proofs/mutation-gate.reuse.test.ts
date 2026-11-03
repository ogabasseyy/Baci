import { describe, expect, it } from 'vitest';
import {
  code,
  execute,
  makeGate,
  transfer,
} from './mutation-gate.test-support';
import { slotState } from './mutation-journal';
import { acceptedReference } from './mutation-journal-references';

/**
 * Proof 2's duplicate-reference check re-sends a reference on purpose. The
 * gate allows that only for a reference this QA key already sent and had
 * accepted, for the same operation, in its own slot.
 */

const DUPLICATE_SLOT = 'p2/duplicate_reference';
const EXPECTED = {
  amountKobo: 100_000,
  walletIds: ['qa-wallet-main', 'qa-wallet-goal'],
  slot: 'p2/w2w',
};

describe('MutationGate: deliberate reference reuse', () => {
  it('re-sends the original reference in its own slot and journals both', () => {
    const { gate, journal } = makeGate();
    const first = execute(gate, transfer());
    const again = gate.begin(
      transfer({
        slot: DUPLICATE_SLOT,
        reuseReference: first.reference,
        reuseOfSlot: 'p2/w2w',
      })
    );
    expect(again.kind).toBe('send');
    expect(again.reference).toBe(first.reference);
    if (again.kind !== 'send') throw new Error('expected send');
    gate.authorizePost(
      '/api/v1/transfer/wallet',
      JSON.stringify({ ...transfer().bodyMatch, reference: first.reference })
    );
    gate.complete(again.permit, 'rejected', 400);
    // Each slot reads its OWN outcome, never the other slot's.
    expect(slotState(journal, 'p2/w2w', 1, 'qa-customer-1')).toMatchObject({
      kind: 'executed',
      outcome: 'accepted',
    });
    expect(slotState(journal, DUPLICATE_SLOT, 1, 'qa-customer-1')).toEqual({
      kind: 'executed',
      reference: first.reference,
      outcome: 'rejected',
    });
  });

  it('never re-sends a duplicate slot that was already used', () => {
    const { gate } = makeGate();
    const first = execute(gate, transfer());
    execute(
      gate,
      transfer({
        slot: DUPLICATE_SLOT,
        reuseReference: first.reference,
        reuseOfSlot: 'p2/w2w',
      })
    );
    expect(
      gate.begin(
        transfer({
          slot: DUPLICATE_SLOT,
          reuseReference: first.reference,
          reuseOfSlot: 'p2/w2w',
        })
      )
    ).toMatchObject({ kind: 'resume' });
  });

  it('refuses a reference the journal never sent', () => {
    const { gate } = makeGate();
    expect(
      code(() =>
        gate.begin(
          transfer({
            slot: DUPLICATE_SLOT,
            reuseReference: 'pvbproof-someone-else-0001',
            reuseOfSlot: 'p2/w2w',
          })
        )
      )
    ).toBe('REFERENCE_REUSE');
  });

  it("refuses another QA key's reference, a different operation, or one that was not accepted", () => {
    const { gate } = makeGate();
    const indeterminate = execute(gate, transfer(), 'indeterminate');
    expect(
      code(() =>
        gate.begin(
          transfer({
            slot: DUPLICATE_SLOT,
            reuseReference: indeterminate.reference,
            reuseOfSlot: 'p2/w2w',
          })
        )
      )
    ).toBe('REFERENCE_REUSE');
    const accepted = execute(gate, transfer({ slot: 'p4/w2w' }));
    expect(
      code(() =>
        gate.begin(
          transfer({
            slot: DUPLICATE_SLOT,
            qaKey: 'qa-customer-2',
            reuseReference: accepted.reference,
            reuseOfSlot: 'p4/w2w',
          })
        )
      )
    ).toBe('REFERENCE_REUSE');
    expect(
      code(() =>
        gate.begin(
          transfer({
            slot: DUPLICATE_SLOT,
            op: 'bank_transfer',
            reuseReference: accepted.reference,
            reuseOfSlot: 'p4/w2w',
          })
        )
      )
    ).toBe('REFERENCE_REUSE');
  });

  it('refuses reuse on an operation that carries no reference field', () => {
    const { gate } = makeGate();
    const first = execute(gate, transfer());
    expect(
      code(() =>
        gate.begin(
          transfer({
            slot: DUPLICATE_SLOT,
            referenceField: undefined,
            reuseReference: first.reference,
            reuseOfSlot: 'p2/w2w',
          })
        )
      )
    ).toBe('REFERENCE_REUSE');
  });
});

describe('MutationGate: reuse is bound to the original transfer', () => {
  const reuseWith = (over: Parameters<typeof transfer>[0]) => {
    const { gate } = makeGate();
    const first = execute(gate, transfer());
    return code(() =>
      gate.begin(
        transfer({
          slot: DUPLICATE_SLOT,
          reuseReference: first.reference,
          reuseOfSlot: 'p2/w2w',
          ...over,
        })
      )
    );
  };

  it('refuses the reverse direction', () => {
    expect(
      reuseWith({
        bodyMatch: {
          source: 'qa-wallet-goal',
          destination: 'qa-wallet-main',
          amount: 100_000,
        },
        walletIds: ['qa-wallet-goal', 'qa-wallet-main'],
      })
    ).toBe('REFERENCE_REUSE');
  });

  it('refuses reuse claiming another original slot', () => {
    expect(reuseWith({ reuseOfSlot: 'p4/w2w' })).toBe('REFERENCE_REUSE');
  });

  it('refuses reuse that names no original slot', () => {
    expect(reuseWith({ reuseOfSlot: undefined })).toBe('REFERENCE_REUSE');
  });

  it('refuses reuse with a different amount', () => {
    expect(reuseWith({ amountKobo: 200_000 })).toBe('REFERENCE_REUSE');
  });

  it('refuses reuse between different wallets', () => {
    expect(
      reuseWith({ walletIds: ['qa-wallet-main', 'qa-wallet-other'] })
    ).toBe('REFERENCE_REUSE');
  });
});

describe('acceptedReference', () => {
  it('is true only for an accepted send by that key and operation', () => {
    const { gate, journal } = makeGate();
    const first = execute(gate, transfer());
    expect(
      acceptedReference(
        journal,
        first.reference,
        'qa-customer-1',
        'wallet_transfer',
        EXPECTED
      )
    ).toBe(true);
    expect(
      acceptedReference(
        journal,
        first.reference,
        'qa-customer-1',
        'bank_transfer',
        EXPECTED
      )
    ).toBe(false);
    expect(
      acceptedReference(
        journal,
        first.reference,
        'qa-customer-2',
        'wallet_transfer',
        EXPECTED
      )
    ).toBe(false);
    expect(
      acceptedReference(
        journal,
        'pvbproof-x',
        'qa-customer-1',
        'wallet_transfer',
        EXPECTED
      )
    ).toBe(false);
  });
});
