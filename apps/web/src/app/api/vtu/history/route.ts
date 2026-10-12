import { after, type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  extractMetadataField,
  hasRecentBackfillSchedule,
  isString,
  MAX_TOKEN_BACKFILL_SCHEDULES,
  normalizeMetadata,
  scheduleVoucherPinBackfill,
  shouldBackfillForStatus,
  shouldBackfillForType,
} from '@/lib/vtu-voucher-backfill';
import { historyQuerySchema } from '@/schemas/vtu';

const PAYMENT_STATUS_BATCH_SIZE = 250;

type PaymentGateway = 'paystack' | 'korapay';

function isPaymentGateway(value: unknown): value is PaymentGateway {
  return value === 'paystack' || value === 'korapay';
}

function getPaymentStatusKey(gateway: string, reference: string): string {
  return `${gateway}:${reference}`;
}

function parseHistoryNumber({
  field,
  invalidMessage,
  transactionId,
  value,
}: {
  field: string;
  invalidMessage: string;
  transactionId: unknown;
  value: unknown;
}) {
  const amount = Number(value);
  if (Number.isFinite(amount)) {
    return amount;
  }

  console.error(invalidMessage, {
    [field]: value,
    transactionId,
  });
  return 0;
}

function parseHistoryAmount(value: unknown, transactionId: unknown) {
  return parseHistoryNumber({
    field: 'amount',
    invalidMessage: 'Invalid VTU transaction amount in history response:',
    transactionId,
    value,
  });
}

function parseHistoryCashback(value: unknown, transactionId: unknown) {
  return parseHistoryNumber({
    field: 'customerCashback',
    invalidMessage: 'Invalid VTU customer cashback amount in history response:',
    transactionId,
    value,
  });
}

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
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const { merchantSlug, type, limit } = parsed.data;

    const { data: merchant, error: merchantError } = await supabase
      .from('merchants')
      .select('id')
      .eq('slug', merchantSlug)
      .single();

    if (merchantError || !merchant) {
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

      if (customerByEmail) {
        customer = customerByEmail;
      }
    }

    if (!customer) {
      return NextResponse.json({ transactions: [] });
    }

    let query = supabase
      .from('vtu_transactions')
      .select(
        'id, created_at, type, status, amount, network_provider, phone_number, biller_name, biller_item_code, customer_identifier, customer_name, request_reference, transaction_id, error_message, customer_cashback, metadata'
      )
      .eq('merchant_id', merchant.id)
      .eq('customer_id', customer.id);

    if (type) {
      query = query.eq('type', type);
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
        hasRecentBackfillSchedule(candidate.metadata)
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
        ({ transaction, voucherPin }) => {
          const {
            metadata: transactionMetadata,
            transaction_id: _transactionId,
            ...publicTransaction
          } = transaction;
          const dataPlanCode = extractMetadataField(
            transactionMetadata,
            'dataPlanCode',
            isString
          );
          // Delivered units (e.g. prepaid electricity kWh) and the meter/
          // customer address, surfaced so the receipt can render them.
          const units = extractMetadataField(
            transactionMetadata,
            'units',
            isString
          );
          const address = extractMetadataField(
            transactionMetadata,
            'address',
            isString
          );
          const paymentGateway = extractMetadataField(
            transactionMetadata,
            'gateway',
            isPaymentGateway
          );
          const paymentReference = extractMetadataField(
            transactionMetadata,
            'paymentReference',
            isString
          );
          // Refund confirmation for failed wallet debits: the failed
          // status persists BEFORE the refund RPC runs, so clients must
          // not treat failed as refunded. Pending = debited, failed,
          // refund not yet issued (the cron confirms it).
          const walletDebited = transactionMetadata.walletDebited === true;
          const refundIssued = transactionMetadata.refundIssued === true;
          const refundAmount = transactionMetadata.refundAmount;
          const refundedToWallet =
            refundIssued && typeof refundAmount === 'number'
              ? refundAmount
              : null;

          return {
            ...publicTransaction,
            amount: parseHistoryAmount(transaction.amount, transaction.id),
            customer_cashback:
              transaction.customer_cashback != null
                ? parseHistoryCashback(
                    transaction.customer_cashback,
                    transaction.id
                  )
                : null,
            payment_gateway: paymentGateway,
            payment_reference: paymentReference,
            payment_status:
              paymentGateway && paymentReference
                ? (paymentStatusByReference.get(
                    getPaymentStatusKey(paymentGateway, paymentReference)
                  ) ?? null)
                : null,
            repeat_data_plan_code: dataPlanCode,
            voucher_pin: voucherPin,
            units,
            address,
            refund_pending:
              transaction.status === 'failed' && walletDebited && !refundIssued,
            refunded_to_wallet: refundedToWallet,
          };
        }
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
