import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import {
  jsonResponse,
  liveJustSubmittedNotFound,
  liveTransactionStatus,
} from './transaction-status-live.test-support';
import { classifyTransferReferenceFailure } from './transfer-reference-lookup';
import { queryTransactionStatus } from './transfers';

const binding = {
  reference: 'pvb-save-00000000-0000-4000-8000-000000000002',
  amountKobo: 10000,
  sourceWalletId: '01JBSYNTHETICSOURCEWALLET1',
  destinationWalletId: '01JBSYNTHETICGOALWALLET001',
  customerId: '01JBSYNTHETICCUSTOMER00001',
};

afterEach(() => vi.unstubAllGlobals());

// Shape: docs/piggyvest-contract-evidence/2026-10-31.md, P2 (terminal
// record; existing typed TSQ schema rejected it before this change).
describe('queryTransactionStatus against the live sandbox TSQ shape', () => {
  it.each([
    'pending',
    'successful',
  ] as const)('accepts the live wallet-transfer %s record (no currency field)', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(liveTransactionStatus(binding, status)))
    );
    const result = await queryTransactionStatus(
      { token: 'synthetic-token' },
      { reference: binding.reference, walletId: binding.sourceWalletId }
    );
    expect(result).toMatchObject({
      status,
      amount: binding.amountKobo,
      third_party_reference: binding.reference,
      source_wallet: binding.sourceWalletId,
      destination_wallet: binding.destinationWalletId,
    });
  });

  it('surfaces the just-submitted 404 as not found, never as a parsed result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(liveJustSubmittedNotFound, 404))
    );
    const failure = await queryTransactionStatus(
      { token: 'synthetic-token' },
      { reference: binding.reference, walletId: binding.sourceWalletId }
    ).catch((error: unknown) => error);
    if (!(failure instanceof PiggyvestApiError))
      throw new Error('Expected a PiggyVest API error');
    expect(failure.status).toBe(404);
    expect(classifyTransferReferenceFailure(failure)).toBe('not_found');
  });
});
