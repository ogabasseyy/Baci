import { describe, expect, it } from 'vitest';
import { MovementLedger } from './movement-ledger';

describe('MovementLedger', () => {
  it('starts quiet', () => {
    expect(new MovementLedger().isQuiet('a', 'b')).toBe(true);
  });

  it('is quiet when every movement is settled', () => {
    const ledger = new MovementLedger();
    ledger.append({ from: null, to: 'a', amountKobo: 5, settled: true });
    ledger.append({ from: 'a', to: 'b', amountKobo: 3, settled: true });
    expect(ledger.isQuiet('a', 'b')).toBe(true);
  });

  it('an unsettled movement makes both of its wallets not quiet', () => {
    const ledger = new MovementLedger();
    ledger.append({ from: 'a', to: 'b', amountKobo: 3, settled: false });
    expect(ledger.isQuiet('a')).toBe(false);
    expect(ledger.isQuiet('b')).toBe(false);
    expect(ledger.isQuiet('a', 'c')).toBe(false);
    expect(ledger.isQuiet('c')).toBe(true);
  });

  it('an unsettled deposit touches only its destination', () => {
    const ledger = new MovementLedger();
    ledger.append({ from: null, to: 'a', amountKobo: 5, settled: false });
    expect(ledger.isQuiet('a')).toBe(false);
    expect(ledger.isQuiet('b')).toBe(true);
  });

  it('keeps a copy, so a later edit of the input changes nothing', () => {
    const ledger = new MovementLedger();
    const movement = { from: null, to: 'a', amountKobo: 5, settled: false };
    ledger.append(movement);
    movement.settled = true;
    expect(ledger.isQuiet('a')).toBe(false);
  });
});
