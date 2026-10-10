import 'server-only';
import { primaryWalletCardCheckoutSchemas as schemas } from '@/schemas/primary-wallet-card-checkout';
import { createPrimaryWalletCardCheckoutExecutor } from './primary-wallet-card-checkout-executor';
import { readPrimaryWalletCardCheckoutRuntimeDrain } from './primary-wallet-card-checkout-runtime';
import {
  isReversalEvent,
  reversalTransactionReference,
  webhookMetadataOf,
  webhookObject,
} from './primary-wallet-card-checkout-webhook-shape';

type Executor = ReturnType<typeof createPrimaryWalletCardCheckoutExecutor>;

// Paystack's documented refund webhook identifies the refund with
// `refund_reference` and carries neither `data.id` nor
// `data.reference`; disputes keep the numeric/string id fallback.
function reversalProviderEventId(
  event: string,
  data: Record<string, unknown>
): string | null {
  if (event === 'refund.processed') {
    const reference = data.refund_reference;
    return typeof reference === 'string' &&
      reference.length >= 1 &&
      reference.length <= 128
      ? reference
      : null;
  }
  if (typeof data.id === 'number') return String(data.id);
  if (typeof data.id === 'string') return data.id;
  if (typeof data.reference === 'string') return data.reference;
  return null;
}

// Refund amounts arrive as decimal kobo strings ("10000"); disputes
// carry numbers. Accept both, strictly: unsigned integer text only,
// so "10.5", "-3", or "" stay retryable instead of settling on a
// misread amount.
function reversalAmountKobo(data: Record<string, unknown>): number | null {
  const amount = data.amount;
  if (typeof amount === 'number' && Number.isInteger(amount) && amount >= 1)
    return amount;
  if (
    typeof amount === 'string' &&
    /^[0-9]{1,10}$/.test(amount) &&
    Number(amount) >= 1
  )
    return Number(amount);
  return null;
}

function disputeResolution(
  event: string,
  data: Record<string, unknown>
): 'won' | 'lost' | null {
  if (event !== 'charge.dispute.resolve') return null;
  // Paystack resolves a dispute as declined (merchant won, no money
  // moved) or merchant-accepted (merchant lost, the refund stands).
  // Anything else stays unresolved: the fence holds until the outcome
  // is unambiguous.
  if (data.status === 'resolved' && data.resolution === 'declined')
    return 'won';
  if (data.resolution === 'merchant-accepted') return 'lost';
  return null;
}

/**
 * Durably records a Paystack refund or dispute against the original
 * primary-card checkout.
 *
 * Money-out evidence has the same status as money-in evidence: a refund
 * the ledger ignores is a customer charged twice (refund issued by
 * Paystack, full custody still settled to us). Paystack's documented
 * refund webhook carries no metadata — only the original transaction
 * reference — so the operation is derived from the reference tail and
 * ownership is validated against the stored intent and runtime, never
 * webhook fields: the intent's tenant IDs come from our own table, and
 * must equal the deployment's. A reversal against an uncollected
 * checkout abandons it (releasing treasury); against a collected
 * checkout it flags the ledger and blocks re-credit. A dispute
 * resolution updates the dispute's row: won lifts the fence (no money
 * moved), lost keeps it. Latest provider outcome wins.
 *
 * 200 only once the reversal is durable; anything unresolved returns
 * null so the sync boundary keeps the delivery retryable.
 */
export async function reconcilePrimaryWalletCardCheckoutReversal(input: {
  body: unknown;
  runtime?: unknown;
  execute?: Executor;
}): Promise<Response | null> {
  const body = webhookObject(input.body);
  const data = body ? webhookObject(body.data) : null;
  if (!body || !data) return null;
  if (typeof body.event !== 'string' || !isReversalEvent(body.event))
    return null;
  const transactionReference = reversalTransactionReference(data);
  const tail =
    transactionReference &&
    /^pvb-first-primary-([0-9a-fA-F-]{36})$/.exec(transactionReference);
  if (!tail) return null;
  const operationId = tail[1] as string;
  // Metadata is a best-effort cross-check, never a requirement: the
  // documented refund shape omits it. When present it must agree with
  // the reference; a self-contradictory delivery stays retryable.
  const metadata = webhookMetadataOf(input.body);
  if (
    metadata &&
    typeof metadata.operation_id === 'string' &&
    metadata.operation_id !== operationId
  )
    return null;

  let runtime: ReturnType<typeof readPrimaryWalletCardCheckoutRuntimeDrain>;
  try {
    runtime =
      input.runtime === undefined
        ? readPrimaryWalletCardCheckoutRuntimeDrain()
        : (input.runtime as ReturnType<
            typeof readPrimaryWalletCardCheckoutRuntimeDrain
          >);
  } catch {
    return null;
  }
  if (!runtime) return null;

  let reversal: ReturnType<typeof schemas.reversal.parse>;
  try {
    reversal = schemas.reversal.parse({
      operationId,
      providerEventId: reversalProviderEventId(body.event, data),
      evidence: {
        event: body.event,
        kind: body.event === 'refund.processed' ? 'refund' : 'dispute',
        resolution: disputeResolution(body.event, data),
        // Informational fields coerce to null rather than rejecting the
        // delivery: an authentic event with an absent amount still
        // records, and the amounts reconcile from the provider.
        amountKobo: reversalAmountKobo(data),
        currency:
          typeof data.currency === 'string' && /^[A-Z]{3}$/.test(data.currency)
            ? data.currency
            : null,
        status:
          typeof data.status === 'string' && data.status.length >= 1
            ? data.status.slice(0, 64)
            : null,
        transactionReference,
      },
    });
  } catch {
    return null;
  }

  try {
    const execute =
      input.execute ?? createPrimaryWalletCardCheckoutExecutor(runtime);
    // The intent comes from our own table by the provider-asserted
    // reference; its tenant IDs must equal the deployment's. No email
    // participates: the webhook cannot supply a trustworthy one, and
    // the status-recovery rule excludes it.
    const intent = schemas.intent.parse(
      await execute('reversal_intent', [transactionReference])
    );
    if (
      intent.operationId !== operationId ||
      intent.environment !== runtime.settings.environment ||
      intent.integrationId !== runtime.settings.integrationId ||
      intent.merchantId !== runtime.settings.merchantId ||
      intent.businessId !== runtime.settings.businessId
    )
      throw new Error('Primary card identity unavailable');
    // The write scope is fully server-derived: stored customer IDs
    // plus runtime dims. record_checkout_reversal re-asserts them
    // against the operation row before writing.
    const storageScope = JSON.stringify({
      environment: runtime.settings.environment,
      integrationId: runtime.settings.integrationId,
      merchantId: runtime.settings.merchantId,
      customerId: intent.customerId,
      userId: intent.userId,
      businessId: runtime.settings.businessId,
      email: intent.email,
      expiresAt: runtime.settings.expiresAt,
      callbackUrl: runtime.settings.callbackUrl,
    });
    schemas.reversalOutcome.parse(
      await execute('reversal', [
        storageScope,
        reversal.operationId,
        reversal.evidence.kind,
        reversal.providerEventId,
        JSON.stringify(reversal.evidence),
      ])
    );
    return Response.json(
      { received: true },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return null;
  }
}
