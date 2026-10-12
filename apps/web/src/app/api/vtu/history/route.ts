import { after, type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { hasRecentBackfillSchedule } from '@/lib/vtu-backfill-pacing';
import {
  getPaymentStatusKey,
  projectHistoryTransaction,
} from '@/lib/vtu-history-transaction-projection';
import {
  extractMetadataField,
  isReferenceLessProcessingTransaction,
  isString,
  MAX_TOKEN_BACKFILL_SCHEDULES,
  normalizeMetadata,
  scheduleVoucherPinBackfill,
  shouldBackfillForStatus,
  shouldBackfillForType,
} from '@/lib/vtu-voucher-backfill';
import { withMerchantSlugAliasFallback } from '@/lib/with-merchant-slug-alias-fallback';
import { historyQuerySchema } from '@/schemas/vtu';

const PAYMENT_STATUS_BATCH_SIZE = 250;

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const parsed = historyQuerySchema.safeParse({
      merchantSlug: searchParams.get('merchantSlug'),
      type: searchParams.get('type') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      reference: searchParams.get('reference') ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const { merchantSlug, type, limit, reference } = parsed.data;

    // Alias-aware (mirrors checkout): a processing tab open across a
    // store rename polls with the stale slug; without the fallback the
    // backfill 404s, treats it as permanent, and never settles. Strict:
    // an alias-DB failure throws (retryable 5xx via the outer catch),
    // never a 404 the backfill would treat as terminal.
    const { data: merchant, error: merchantError } =
      await withMerchantSlugAliasFallback(
        merchantSlug,
        (resolvedSlug) =>
          supabase
            .from('merchants')
            .select('id')
            .eq('slug', resolvedSlug)
            .maybeSingle(),
        { strict: true }
      );

    // A lookup ERROR is indeterminate (retryable), not "not found": a
    // transient DB blip must not present as a permanent 404 either.
    if (merchantError) {
      console.error('Failed to resolve VTU history merchant:', merchantError);
      return NextResponse.json(
        { error: 'Failed to fetch history' },
        { status: 500 }
      );
    }

    if (!merchant) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    let customer = null;

    const { data: customerByUserId } = await supabase
      .from('customers')
      .select('id, user_id')
      .eq('merchant_id', merchant.id)
      .eq('user_id', auth.user.id)
      .maybeSingle();

    if (customerByUserId) {
      customer = customerByUserId;
    } else if (auth.user.email) {
      // Keep this GET read-only. VTU checkout resolves and links email-matched
      // customers through resolveVtuCustomer before creating payment rows.
      const { data: customerByEmail } = await supabase
        .from('customers')
        .select('id, user_id')
        .eq('merchant_id', merchant.id)
        .eq('email', auth.user.email)
        .maybeSingle();

      // Tenant isolation: the email claim alone proves nothing (a guest
      // row pre-created with this email may belong to someone else, and
      // an attacker can register an unverified account on it), so only
      // a row already linked to THIS auth user is accepted. Unlinked
      // (null) and mismatched rows fall through to the empty list —
      // never link here: first-claimer-wins on a GET would let an
      // attacker permanently claim a victim's guest history.
      if (customerByEmail?.user_id === auth.user.id) {
        customer = customerByEmail;
      }
    }

    if (!customer) {
      return NextResponse.json({ transactions: [] });
    }

    let query = supabase
      .from('vtu_transactions')
      .select(
        'id, created_at, type, status, amount, network_provider, phone_number, biller_name, biller_item_code, customer_identifier, customer_name, request_reference, transaction_id, error_message, customer_cashback, metadata, source, customer_id'
      )
      .eq('merchant_id', merchant.id)
      .eq('customer_id', customer.id);

    if (type) {
      query = query.eq('type', type);
    }

    // Reference scope (backfills): exact match so the target row is
    // returned no matter how many newer rows of the type exist. The
    // customer_id filter above keeps this to the caller's own rows.
    if (reference) {
      query = query.eq('request_reference', reference);
    }

    const { data: transactions, error: transactionsError } = await query
      .order('created_at', { ascending: false })
      .limit(limit);

    if (transactionsError) {
      console.error('Failed to fetch customer VTU history:', transactionsError);
      return NextResponse.json(
        { error: 'Failed to fetch history' },
        { status: 500 }
      );
    }

    const paymentReferences = Array.from(
      new Set(
        (transactions ?? [])
          .map((transaction) =>
            extractMetadataField(
              transaction.metadata,
              'paymentReference',
              isString
            )
          )
          .filter((reference): reference is string => Boolean(reference))
      )
    );
    const paymentStatusByReference = new Map<string, string>();

    if (paymentReferences.length > 0) {
      for (
        let index = 0;
        index < paymentReferences.length;
        index += PAYMENT_STATUS_BATCH_SIZE
      ) {
        const paymentReferenceBatch = paymentReferences.slice(
          index,
          index + PAYMENT_STATUS_BATCH_SIZE
        );
        const { data: paymentRows, error: paymentRowsError } = await supabase
          .from('transactions')
          .select('gateway, gateway_reference, status')
          .eq('merchant_id', merchant.id)
          .in('gateway_reference', paymentReferenceBatch);

        if (paymentRowsError) {
          console.error('Failed to fetch VTU payment statuses:', {
            error: paymentRowsError,
            paymentReferenceBatchSize: paymentReferenceBatch.length,
          });
          continue;
        }

        for (const paymentRow of paymentRows ?? []) {
          if (
            typeof paymentRow.gateway === 'string' &&
            typeof paymentRow.gateway_reference === 'string' &&
            typeof paymentRow.status === 'string'
          ) {
            paymentStatusByReference.set(
              getPaymentStatusKey(
                paymentRow.gateway,
                paymentRow.gateway_reference
              ),
              paymentRow.status
            );
          }
        }
      }
    }

    const transactionsWithVoucherPins = (transactions ?? []).map(
      (transaction) => {
        const metadata = normalizeMetadata(transaction.metadata);
        const voucherPin = extractMetadataField(
          metadata,
          'voucherPin',
          isString
        );

        return {
          metadata,
          originalMetadata: transaction.metadata,
          transaction,
          voucherPin,
        };
      }
    );

    const tokenBackfillCandidates: typeof transactionsWithVoucherPins = [];
    for (const candidate of transactionsWithVoucherPins) {
      if (tokenBackfillCandidates.length >= MAX_TOKEN_BACKFILL_SCHEDULES) {
        break;
      }

      if (
        candidate.voucherPin !== null ||
        !shouldBackfillForStatus(candidate.transaction.status) ||
        !shouldBackfillForType(candidate.transaction.type) ||
        hasRecentBackfillSchedule(candidate.metadata) ||
        // Pre-filter BEFORE the 3-slot budget: reference-less rows
        // would be rejected downstream anyway, and letting them
        // consume slots starves eligible rows behind them forever
        // (Codex R43 rnTRj).
        isReferenceLessProcessingTransaction(candidate.transaction)
      ) {
        continue;
      }

      tokenBackfillCandidates.push(candidate);
    }

    if (tokenBackfillCandidates.length > 0) {
      after(async () => {
        try {
          const tokenBackfillResults = await Promise.allSettled(
            tokenBackfillCandidates.map((candidate) =>
              scheduleVoucherPinBackfill({
                metadata: candidate.metadata,
                originalMetadata: candidate.originalMetadata,
                supabase,
                transaction: candidate.transaction,
                voucherPin: candidate.voucherPin,
              })
            )
          );

          tokenBackfillResults.forEach((result, index) => {
            if (result.status === 'rejected') {
              console.error('Failed to schedule VTU voucher-pin backfill:', {
                error: result.reason,
                transactionId: tokenBackfillCandidates[index]?.transaction.id,
              });
            }
          });
        } catch (error) {
          console.error('Failed to process VTU voucher-pin backfill queue:', {
            error,
            transactionIds: tokenBackfillCandidates.map(
              (candidate) => candidate.transaction.id
            ),
          });
        }
      });
    }

    return NextResponse.json({
      transactions: transactionsWithVoucherPins.map(
        ({ transaction, voucherPin }) =>
          projectHistoryTransaction({
            paymentStatusByReference,
            transaction,
            voucherPin,
          })
      ),
    });
  } catch (error) {
    console.error('Customer VTU history error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch history' },
      { status: 500 }
    );
  }
}
