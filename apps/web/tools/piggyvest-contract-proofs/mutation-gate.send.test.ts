import { describe, expect, it } from 'vitest';
import type { MutationIntent } from './mutation-gate';
import {
  code,
  execute,
  makeGate,
  SYNTHETIC_EMAIL,
  send,
  transfer,
} from './mutation-gate.test-support';

describe('MutationGate.authorizePost', () => {
  it('refuses a POST with no armed intent', () => {
    const { gate } = makeGate();
    expect(
      code(() => gate.authorizePost('/api/v1/transfer/wallet', '{}'))
    ).toBe('MUTATION_WITHOUT_INTENT');
  });

  it('accepts the matching request exactly once (single-use permit)', () => {
    const { gate } = makeGate();
    const { body } = send(gate, transfer());
    expect(() =>
      gate.authorizePost('/api/v1/transfer/wallet', body)
    ).not.toThrow();
    expect(
      code(() => gate.authorizePost('/api/v1/transfer/wallet', body))
    ).toBe('MUTATION_WITHOUT_INTENT');
  });

  it('refuses a different path or a body that deviates from the journaled intent', () => {
    for (const [path, overrides] of [
      ['/api/v1/transfer/bank', {}],
      ['/api/v1/transfer/wallet', { amount: 999_999 }],
      ['/api/v1/transfer/wallet', { destination: 'house-collection-wallet' }],
      ['/api/v1/transfer/wallet', { reference: 'some-other-reference-1' }],
    ] as const) {
      const { gate } = makeGate();
      const { body } = send(gate, transfer(), overrides);
      expect(code(() => gate.authorizePost(path, body))).toBe(
        'MUTATION_MISMATCH'
      );
    }
  });

  it('refuses malformed bodies and recording-account references in the wire body', () => {
    const { gate } = makeGate();
    send(gate, transfer());
    expect(
      code(() => gate.authorizePost('/api/v1/transfer/wallet', 'nope'))
    ).toBe('MUTATION_MISMATCH');
    const second = makeGate().gate;
    const { body } = send(second, transfer(), {
      narration: 'baci-recording-20261013',
    });
    expect(
      code(() => second.authorizePost('/api/v1/transfer/wallet', body))
    ).toBe('RECORDING_ACCOUNT');
  });

  it('only lets synthetic QA identities through customer creation', () => {
    const intent: MutationIntent = {
      slot: 'p1/create',
      op: 'create_customer',
      path: '/api/v1/customers',
      qaKey: 'qa-customer-1',
      bodyMatch: { third_party_identifier: 'pvbproof:qa-customer-1' },
      walletIds: [],
      amountKobo: null,
    };
    const ok = makeGate().gate;
    ok.begin(intent);
    expect(() =>
      ok.authorizePost(
        '/api/v1/customers',
        JSON.stringify({
          third_party_identifier: 'pvbproof:qa-customer-1',
          email: SYNTHETIC_EMAIL,
        })
      )
    ).not.toThrow();

    const bad = makeGate().gate;
    bad.begin({ ...intent, slot: 'p1/create2' });
    expect(
      code(() =>
        bad.authorizePost(
          '/api/v1/customers',
          JSON.stringify({
            third_party_identifier: 'pvbproof:qa-customer-1',
            email: 'real.person@gmail.com',
          })
        )
      )
    ).toBe('SYNTHETIC_IDENTITY_REQUIRED');
  });
});

describe('MutationGate.complete', () => {
  it('records the outcome so a crash after sending is never re-sent', () => {
    const { gate, journal } = makeGate();
    const begun = execute(gate, transfer(), 'indeterminate');
    expect(journal.entries().at(-1)).toMatchObject({
      phase: 'outcome',
      outcome: 'indeterminate',
      reference: begun.reference,
    });
  });

  it('records not_sent when the guard refused before the request left', () => {
    const { gate, journal } = makeGate();
    const begun = gate.begin(transfer());
    if (begun.kind !== 'send') throw new Error('expected send');
    gate.complete(begun.permit, 'indeterminate', null);
    expect(journal.entries().at(-1)).toMatchObject({ outcome: 'not_sent' });
  });
});

describe('MutationGate: unknown modes fail closed', () => {
  it('refuses to begin a mutation in any mode that is not explicitly mutation-capable', () => {
    const bogus = 'toString' as unknown as Parameters<
      typeof makeGate
    >[0] extends infer O
      ? O extends { mode?: infer M }
        ? M
        : never
      : never;
    expect(code(() => makeGate({ mode: bogus }).gate.begin(transfer()))).toBe(
      'MUTATION_IN_READONLY'
    );
  });
});

describe('MutationGate: slots belong to one QA customer', () => {
  it('sends for QA customer B even though QA customer A already used the same slot', () => {
    const { gate, journal } = makeGate();
    execute(gate, transfer());
    const other = makeGate({ journal, runId: 'run2' }).gate.begin(
      transfer({ qaKey: 'qa-customer-2' })
    );
    expect(other.kind).toBe('send');
  });
});
