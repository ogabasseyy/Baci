/**
 * Bodies laid out like the samples on PiggyVest's public API docs pages:
 * - Webhooks > Events, `wallet-transfer.outflow.success`: our reference is
 *   the envelope's `pvb_third_party_reference`; `eventData` carries
 *   PiggyVest's own ids (`third_party_reference` / `initiator_reference`
 *   start with `PVB`), category `p2p` and `fee: null`.
 * - Transactions > Single transaction (GET /api/v1/transaction/:id): the
 *   same record fields the live TSQ answered in
 *   docs/piggyvest-contract-evidence/2026-10-31.md, P2, plus `break_down`.
 * - Transfers > Transfer status (GET /api/v1/transaction/verify): the
 *   documented minimal bank-transfer body, which names no wallet.
 *
 * Every value is synthetic; only field names, types and layout follow the
 * docs.
 */
export interface DocsTransferBinding {
  reference: string;
  amountKobo: number;
  sourceWalletId: string;
  destinationWalletId: string;
}

export function docsWalletTransferEnvelope(binding: DocsTransferBinding) {
  return {
    eventId: '01JBDOCSEVENT0000000000001',
    customer_id: '00000000-0000-4000-8000-00000000c001',
    eventType: 'wallet-transfer.outflow.success',
    eventCategory: 'wallet_transfer',
    eventData: {
      id: '00000000-0000-4000-8000-00000000d001',
      customer_id: '00000000-0000-4000-8000-00000000c001',
      source_wallet: '01JBDOCSFAASSOURCE00000001',
      destination_wallet: '00000000-0000-4000-8000-00000000f002',
      type: 'inter',
      category: 'p2p',
      amount: binding.amountKobo,
      currency: 'NGN',
      narration: 'Synthetic transfer',
      ip_address: '192.0.2.10',
      transaction_id: '00000000-0000-4000-8000-00000000d002',
      timestamp: '2026-10-31T10:00:05.000Z',
      internal_reference: '01JBDOCSINTERNAL0000000001',
      status: 'COMPLETED',
      third_party_reference: 'PVB01JBDOCSPROVIDER0000001',
      initiator_reference: 'PVB01JBDOCSPROVIDER0000001',
      source_wallet_balance: 0,
      source_wallet_ledger_balance: 0,
      destination_wallet_balance: binding.amountKobo,
      destination_wallet_ledger_balance: binding.amountKobo,
      source_transaction_balance: 0,
      destination_transaction_balance: binding.amountKobo,
      reference: '01JBDOCSINTERNAL0000000001',
      fee: null,
      reason: null,
      batch_id: null,
      withholding_tax_type: null,
      accrued_interest_wallet: null,
    },
    pvb_reference: 'PVB01JBDOCSENVELOPE0000001',
    pvb_wallet: binding.sourceWalletId,
    pvb_destination_wallet: binding.destinationWalletId,
    pvb_third_party_reference: binding.reference,
    pvb_schedule_payment_id: null,
  };
}

export function docsSingleTransaction(binding: DocsTransferBinding) {
  return {
    status: true,
    message: 'Transaction fetched successfully',
    data: {
      id: 'TRX01JBDOCSSINGLE000000001',
      available_balance: 0,
      amount: binding.amountKobo,
      fee: 0,
      reference: '01JBDOCSPROVIDERREF0000001',
      category: 'p2p',
      third_party_reference: binding.reference,
      customer_id: '01JBDOCSCUSTOMER0000000001',
      source_wallet: binding.sourceWalletId,
      destination_wallet: binding.destinationWalletId,
      narration: 'Synthetic transfer',
      internal_reference: 'TRX01JBDOCSSINGLE000000001',
      status: 'successful',
      session_id: null,
      meta: {},
      created_at: '2026-10-31T10:00:00.000000Z',
      updated_at: '2026-10-31T10:00:09.000000Z',
      source_wallet_balance: 0,
      destination_wallet_balance: binding.amountKobo,
      break_down: {
        gross_interest_payout: 0,
        withholding_tax: 0,
        net_interest_payout: 0,
      },
    },
  };
}

export function docsMinimalTransactionStatus(binding: DocsTransferBinding) {
  return {
    status: true,
    message: 'Transaction status retrieved',
    data: {
      reference: binding.reference,
      status: 'success',
      amount: binding.amountKobo,
      recipient: '0000000000',
      bank: 'Synthetic Bank',
      created_at: '2026-10-31T10:00:00Z',
    },
  };
}
