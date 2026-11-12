import { describe, expect, it } from 'vitest';
import { InflowLedgerError } from './inflow-ledger-error';

describe('InflowLedgerError', () => {
  it('carries its code, name and conflict detail', () => {
    const conflict = {
      providerTransactionId: 'txn',
      mismatchedFields: ['amount_kobo'],
      bodyDigest: 'a'.repeat(64),
    };
    const error = new InflowLedgerError(
      'INFLOW_LEDGER_CONFLICT',
      'conflict',
      conflict
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'InflowLedgerError',
      code: 'INFLOW_LEDGER_CONFLICT',
      message: 'conflict',
      conflict,
    });
  });

  it('has no conflict detail for non-conflict errors', () => {
    expect(
      new InflowLedgerError('INFLOW_LEDGER_UNMAPPED', 'unmapped').conflict
    ).toBeUndefined();
  });
});
