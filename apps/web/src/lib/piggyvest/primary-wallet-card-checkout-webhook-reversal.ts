import 'server-only';
import { primaryWalletCardCheckoutSchemas as schemas } from '@/schemas/primary-wallet-card-checkout';
import { createPrimaryWalletCardCheckoutExecutor } from './primary-wallet-card-checkout-executor';
import { assertCheckoutIntentOwnership } from './primary-wallet-card-checkout-ownership';
import { readPrimaryWalletCardCheckoutRuntimeDrain } from './primary-wallet-card-checkout-runtime';
import {
  webhookMetadataOf,
  webhookObject,
} from './primary-wallet-card-checkout-webhook-shape';

type Executor = ReturnType<typeof createPrimaryWalletCardCheckoutExecutor>;

const REVERSAL_EVENTS = ['refund.processed', 'charge.dispute.create'] as const;

function nestedTransactionReference(
  data: Record<string, unknown>
): string | null {
  for (const key of ['transaction', 'dispute']) {
    const nested = webhookObject(data[key]);
    const candidate =
      nested && typeof nested.reference === 'string' ? nested.reference : null;
    if (candidate) return candidate;
  }
  return null;
}

/**
 * Durably records a Paystack refund or dispute against the original
 * primary-card checkout.
 *
 * Money-out evidence has the same status as money-in evidence: a refund
 * the ledger ignores is a customer charged twice (refund issued by
 * Paystack, full custody still settled to us). This path cross-binds the
 * metadata operation ID to `transaction_reference` (Paystack puts the
 * ORIGINAL charge reference there, never its own event ID), re-reads
 * the stored intent under the runtime scope — ownership asserted on the
 * six immutable IDs, email excluded like status recovery — and records
 * the durable reversal row. A reversal against an uncollected checkout
 * abandons it (releasing treasury); against a collected checkout it
 * flags the ledger and blocks re-credit.
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
  const metadata = webhookMetadataOf(input.body);
  if (!body || !data || !metadata) return null;
  if (
    typeof body.event !== 'string' ||
    !(REVERSAL_EVENTS as readonly string[]).includes(body.event)
  )
    return null;
  const operationId =
    typeof metadata.operation_id === 'string' ? metadata.operation_id : null;
  const transactionReference =
    (typeof data.transaction_reference === 'string'
      ? data.transaction_reference
      : null) ?? nestedTransactionReference(data);
  if (!operationId) return null;
  if (transactionReference !== `pvb-first-primary-${operationId}`) return null;

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
  if (
    !runtime ||
    metadata.integration_id !== runtime.settings.integrationId ||
    metadata.merchant_id !== runtime.settings.merchantId ||
    metadata.environment !== runtime.settings.environment
  )
    return null;

  let reversal: ReturnType<typeof schemas.reversal.parse>;
  try {
    reversal = schemas.reversal.parse({
      operationId,
      providerEventId:
        typeof data.id === 'number'
          ? String(data.id)
          : typeof data.id === 'string'
            ? data.id
            : typeof data.reference === 'string'
              ? data.reference
              : null,
      evidence: {
        event: body.event,
        kind: body.event === 'charge.dispute.create' ? 'dispute' : 'refund',
        // Informational fields coerce to null rather than rejecting the
        // delivery: an authentic event with an absent amount still
        // records, and the amounts reconcile from the provider.
        amountKobo:
          typeof data.amount === 'number' &&
          Number.isInteger(data.amount) &&
          data.amount >= 1
            ? data.amount
            : null,
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
    // The scope is identical to the charge service's storage scope: the
    // metadata five IDs plus runtime dims. read_operation asserts them
    // against the stored customer row server-side, so a mangled-or-replayed
    // delivery for another tenant fails here before anything is written.
    // The scope email is carried but never compared (status-recovery
    // rule); the webhook cannot supply a trustworthy one.
    const storageScope = JSON.stringify({
      environment: runtime.settings.environment,
      integrationId: runtime.settings.integrationId,
      merchantId: runtime.settings.merchantId,
      customerId: metadata.customer_id,
      userId: metadata.user_id,
      businessId: runtime.settings.businessId,
      email: null,
      expiresAt: runtime.settings.expiresAt,
      callbackUrl: runtime.settings.callbackUrl,
    });
    const intent = schemas.intent.parse(
      await execute('read', [storageScope, operationId])
    );
    if (intent.operationId !== operationId)
      throw new Error('Primary card identity unavailable');
    assertCheckoutIntentOwnership(
      {
        environment: runtime.settings.environment,
        integrationId: runtime.settings.integrationId,
        merchantId: runtime.settings.merchantId,
        customerId: metadata.customer_id,
        userId: metadata.user_id,
        businessId: runtime.settings.businessId,
      },
      intent
    );
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
