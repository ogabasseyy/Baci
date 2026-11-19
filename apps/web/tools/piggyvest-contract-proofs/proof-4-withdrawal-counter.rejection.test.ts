import { afterEach, describe, expect, it, vi } from 'vitest';
import { fail } from './mock-sandbox-types';
import { runProof4 } from './proof-4-withdrawal-counter';
import { setupScenario } from './scenario';
import { makeHarness } from './test-harness.test-support';

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
});

describe('proof 4: a refused bank outflow', () => {
  it('records the redacted refusal message and leaves the bank finding unknown', async () => {
    const h = makeHarness();
    dispose = h.dispose;
    await setupScenario(h.ctx);
    const ledger = h.mock.sandbox.ledger;
    const real = ledger.transfer.bind(ledger);
    vi.spyOn(ledger, 'transfer').mockImplementation((kind, body) =>
      kind === 'bank'
        ? fail('Invalid bank code 9999999 for account 0123456789', 400)
        : real(kind, body)
    );
    const result = await runProof4(h.ctx);
    expect(result.values.bank_outcome).toBe('rejected');
    expect(result.values.bank_rejection_message).toBe(
      'Invalid bank code # for account B1'
    );
    expect(
      result.findings.find((f) => f.id === 'bank_outflow_changes_counter')
        ?.answer
    ).toBe('unknown');
    expect(h.redactor.leaks(JSON.stringify(result))).toEqual([]);
  });
});
