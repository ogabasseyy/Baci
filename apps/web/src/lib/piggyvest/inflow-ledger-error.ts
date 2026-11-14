/** Error raised by the verified inflow ledger (see inflow-ledger.ts). */
export type InflowLedgerConflict = {
  providerTransactionId: string;
  mismatchedFields: string[];
  bodyDigest: string;
};

export class InflowLedgerError extends Error {
  readonly code:
    | 'INFLOW_LEDGER_INVALID'
    | 'INFLOW_LEDGER_UNMAPPED'
    | 'INFLOW_LEDGER_CONFLICT'
    | 'INFLOW_LEDGER_UNRESOLVED'
    | 'INFLOW_LEDGER_STORAGE_ERROR';
  readonly conflict?: InflowLedgerConflict;

  constructor(
    code: InflowLedgerError['code'],
    message: string,
    conflict?: InflowLedgerConflict
  ) {
    super(message);
    this.name = 'InflowLedgerError';
    this.code = code;
    this.conflict = conflict;
  }
}
