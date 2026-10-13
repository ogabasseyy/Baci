import { describe, expect, it } from 'vitest';
import { PrefundedCardPostgresFailure } from './prefunded-card-postgres-failure';

describe('safe PostgreSQL readiness diagnostics', () => {
  it('retains only an allowlisted code without provider messages, details or causes', () => {
    const original = Object.assign(new Error('password=private-canary'), {
      code: '28P01',
      detail: 'private-host',
      query: 'private-query',
    });
    const failure = new PrefundedCardPostgresFailure(
      'worker',
      'connect',
      original
    );
    expect(failure.message).toBe('Prefunded card database unavailable');
    expect(failure.diagnostic).toEqual({
      profile: 'worker',
      phase: 'connect',
      code: '28P01',
    });
    expect(failure.cause).toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain('private');
  });

  it.each([
    'private-canary',
    '28P01 private-canary',
    '',
    'ABCDE',
  ])('drops arbitrary error codes: %s', (code) => {
    const failure = new PrefundedCardPostgresFailure(
      'evidence',
      'session-query',
      Object.assign(new Error('private-canary'), { code })
    );
    expect(failure.diagnostic.code).toBe('unclassified');
    expect(JSON.stringify(failure)).not.toContain('private-canary');
  });

  it('does not invoke error-code getters or serialize unknown thrown values', () => {
    const original = Object.defineProperty(
      new Error('private-canary'),
      'code',
      {
        get() {
          throw new Error('private-canary');
        },
      }
    );
    for (const error of [
      original,
      { code: '28P01', password: 'private-canary' },
      'private-canary',
    ]) {
      const failure = new PrefundedCardPostgresFailure(
        'authorizer',
        'identity-query',
        error
      );
      expect(failure.diagnostic.code).toBe('unclassified');
      expect(JSON.stringify(failure)).not.toContain('private-canary');
    }
  });
});
