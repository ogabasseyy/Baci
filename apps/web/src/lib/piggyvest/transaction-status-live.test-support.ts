/**
 * TSQ (GET /api/v1/transaction/verify) envelopes shaped like the PiggyVest
 * sandbox answers recorded in docs/piggyvest-contract-evidence/2026-10-31.md
 * (and .json), P2 (observed: transfer 202, then TSQ http_404 > pending >
 * successful in 9 polls; no currency field). Every value is synthetic; only
 * the field names, types and envelope layout follow the evidence.
 *
 * That run recorded only the 404 bodies and the terminal (successful) body.
 * The pending body was NOT captured, so the pending and failed fixtures
 * assume the terminal layout with a different status.
 *
 * Observed facts the fixtures encode:
 * - a wallet-to-wallet transfer POST answers 202, then TSQ answers HTTP 404
 *   "Transaction Not Found" (with data.processing_status), then pending,
 *   then successful;
 * - an unknown reference answers the same HTTP 404 "Transaction Not Found";
 * - the found record names reference (provider id), third_party_reference
 *   (our reference), amount, fee, status, customer_id, source_wallet and
 *   destination_wallet, and carries NO currency field.
 */
export interface LiveTransferBinding {
  reference: string;
  amountKobo: number;
  sourceWalletId: string;
  destinationWalletId: string;
  customerId: string;
}

export type LiveTransferStatus = 'pending' | 'successful' | 'failed';

export function liveTransactionStatus(
  binding: LiveTransferBinding,
  status: LiveTransferStatus
) {
  return {
    status: true,
    message: 'Transaction status retrieved',
    data: {
      id: 'TRX01JBSYNTHETIC00000000001',
      available_balance: 500000,
      amount: binding.amountKobo,
      fee: 0,
      reference: '01JBSYNTHETICPROVIDERREF01',
      category: 'p2p',
      third_party_reference: binding.reference,
      customer_id: binding.customerId,
      source_wallet: binding.sourceWalletId,
      destination_wallet: binding.destinationWalletId,
      narration: 'Savings contribution',
      internal_reference: 'TRX01JBSYNTHETIC00000000001',
      status,
      session_id: null,
      meta: {
        source_name: 'Synthetic Source',
        destination_name: 'Synthetic Destination',
        source_number: '01JBSYNTHETICSOURCENUM0001',
        destination_number: '01JBSYNTHETICDESTNUM00001',
        source_bank_name: 'Synthetic Bank',
        destination_bank_name: 'Synthetic Bank',
        faas_source_number: '00000000-0000-4000-8000-0000000000aa',
        faas_destination_number: '01JBSYNTHETICFAASDEST0001',
      },
      created_at: '2026-10-31T10:00:00.000000Z',
      updated_at: '2026-10-31T10:00:09.000000Z',
      source_wallet_balance: 490000,
      destination_wallet_balance: 10000,
    },
  };
}

/** HTTP 404 body for a reference PiggyVest has never seen. */
export const liveUnknownReferenceNotFound = {
  status: false,
  message: 'Transaction Not Found',
  data: {},
};

/** HTTP 404 body seen immediately after a 202-accepted transfer. */
export const liveJustSubmittedNotFound = {
  status: false,
  message: 'Transaction Not Found',
  data: { processing_status: 'processing' },
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
