import { describe, expect, it } from 'vitest';
import { readCreditDirectAttempt } from './credit-direct-attempt';

describe('readCreditDirectAttempt', () => {
  it('trims references while preserving their case', () => {
    const attempt = readCreditDirectAttempt(
      JSON.stringify({
        creditDirectTransactionId: ' Txn-B ',
        creditDirectSupersededReferences: [' Txn-A ', null, 42],
      })
    );

    expect(attempt.reference).toBe('Txn-B');
    expect(attempt.supersededReferences).toEqual(['Txn-A']);
  });

  it.each(['{broken', 'null', '[]'])('ignores non-object notes %s', (notes) => {
    expect(readCreditDirectAttempt(notes)).toEqual({
      reference: null,
      supersededReferences: [],
      hasCompletionTimestamp: false,
      hasCurrentCompletion: false,
    });
  });

  it('reads the legacy transaction key and matches its completed reference', () => {
    expect(
      readCreditDirectAttempt(
        JSON.stringify({
          credit_directTransactionId: ' Legacy-Txn ',
          creditDirectClientCompletedTransactionId: 'Legacy-Txn',
          creditDirectClientCompletedAt: '2026-07-01T00:01:00.000Z',
        })
      )
    ).toMatchObject({ reference: 'Legacy-Txn', hasCurrentCompletion: true });
  });

  it('retains a valid legacy timestamp without confirming an active attempt', () => {
    const attempt = readCreditDirectAttempt(
      JSON.stringify({
        creditDirectClientCompletedAt: '2026-07-01T00:01:00.000Z',
      })
    );

    expect(attempt.hasCompletionTimestamp).toBe(true);
    expect(attempt.hasCurrentCompletion).toBe(false);
  });
});
