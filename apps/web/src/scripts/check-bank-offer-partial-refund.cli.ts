import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { listPaystackRefunds } from '../lib/orders/list-paystack-refunds';
import {
  partialRefundCliArgsSchema,
  partialRefundDatabaseUrlSchema,
  partialRefundManifestSchema,
} from '../schemas/bank-offer-partial-refund-input';
import { checkBankOfferPartialRefund } from './check-bank-offer-partial-refund';

async function main() {
  const args = partialRefundCliArgsSchema.safeParse(process.argv.slice(2));
  if (!args.success) {
    console.error(
      'Usage: check:bank-offer-partial-refund <order UUID> <merchant UUID> <return manifest.json>'
    );
    process.exitCode = 1;
    return;
  }
  const [orderId, merchantId, manifestFile] = args.data;
  const manifest = partialRefundManifestSchema.safeParse(
    JSON.parse(await readFile(manifestFile, 'utf8'))
  );
  if (!manifest.success) {
    console.error(
      'Invalid return manifest. See docs/runbooks/bank-card-offers.md.'
    );
    process.exitCode = 1;
    return;
  }
  const sql = postgres(
    partialRefundDatabaseUrlSchema.parse(
      process.env.BANK_OFFER_REFUND_READ_DATABASE_URL
    ),
    {
      ssl: 'verify-full',
      max: 1,
      connect_timeout: 10,
      connection: {
        default_transaction_read_only: true,
        statement_timeout: 5_000,
      },
    }
  );
  try {
    const [row] = await sql<{ snapshot: unknown }[]>`
      SELECT jsonb_build_object(
        'capture', jsonb_build_object(
          'reference', attempt.verified_evidence->>'reference',
          'id', attempt.verified_evidence->>'providerVerificationId',
          'domain', attempt.provider_domain,
          'amountKobo', public.get_bank_card_offer_refundable_amount(
            snapshot.order_id, snapshot.merchant_id, attempt.transaction_id,
            attempt.verified_evidence->>'reference'
          )
        ),
        'merchandiseNetKobo', (snapshot.offer_quote->>'productSubtotalKobo')::bigint
          - (snapshot.offer_quote->>'discountKobo')::bigint,
        'allocations', snapshot.offer_quote->'allocations'
      ) AS snapshot
      FROM private.bank_card_offer_order_snapshots AS snapshot
      JOIN private.bank_card_offer_payment_attempts AS attempt
        ON attempt.order_id = snapshot.order_id
      WHERE snapshot.order_id = ${orderId}::uuid
        AND snapshot.merchant_id = ${merchantId}::uuid
        AND attempt.refund_dispatch_claim IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.order_cancellation_side_effects AS effect
          WHERE effect.order_id = snapshot.order_id
            AND effect.merchant_id = snapshot.merchant_id
            AND effect.step = 'refund' AND effect.status <> 'completed'
        )
    `;
    if (!row) {
      console.error('No eligible capture found for this order and merchant.');
      process.exitCode = 1;
      return;
    }
    try {
      const result = await checkBankOfferPartialRefund(
        row.snapshot,
        manifest.data,
        ({ reference, ...expectedCapture }) =>
          listPaystackRefunds(reference, {
            expectedCapture,
            deadlineMs: Date.now() + 15_000,
          })
      );
      console.log(JSON.stringify(result));
    } catch (error) {
      // Fetch and schema errors can contain provider or session details.
      const expectedMessages = new Set([
        'Duplicate unit in refund manifest',
        'Unit is absent from the saved quote',
        'Duplicate unit in saved quote',
        'Saved allocations do not reconcile',
        'Duplicate prior refund ID',
        'Unverified Paystack refund history',
        'Paystack refund history exceeds the verified capture',
        'Proposed amount exceeds remaining Paystack balance',
        'Reconcile prior Paystack refunds to saved units before continuing',
        'Saved Paystack capture mismatch',
      ]);
      console.error(
        error instanceof Error && expectedMessages.has(error.message)
          ? error.message
          : 'Could not verify the saved capture, allocations, or Paystack refund history.'
      );
      process.exitCode = 1;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Driver and file errors may contain connection attributes or raw input.
main().catch(() => {
  console.error(
    'Could not read the return manifest or connect to the Operations database.'
  );
  process.exitCode = 1;
});
