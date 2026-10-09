import 'server-only';
import { createPrimaryWalletCardCheckoutExecutor } from './primary-wallet-card-checkout-executor';
import { createPrimaryWalletCardCheckoutProvider } from './primary-wallet-card-checkout-provider';
import { readPrimaryWalletCardCheckoutRuntimeDrain } from './primary-wallet-card-checkout-runtime';
import { createPrimaryWalletCardCheckoutService } from './primary-wallet-card-checkout-service';

type Executor = ReturnType<typeof createPrimaryWalletCardCheckoutExecutor>;
type Provider = ReturnType<typeof createPrimaryWalletCardCheckoutProvider>;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function metadataOf(body: unknown): Record<string, unknown> | null {
  const data = object(
    body && typeof body === 'object' && 'data' in body ? body.data : null
  );
  if (!data) return null;
  let metadata: unknown = data.metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  return object(metadata);
}

/**
 * Durably reconciles an authentic primary card-checkout webhook.
 *
 * The sync boundary can only ask Paystack to retry; when the client never
 * comes back (killed app, lost callback) retries eventually exhaust and the
 * charged funds stay uncredited. This runs the same authoritative
 * verification the status endpoint uses — live Paystack verify bound to the
 * stored intent, then durable collection/reconciliation — and acknowledges
 * (200) only once the outcome is durable. Anything unresolved returns null
 * so the sync boundary keeps the webhook retryable.
 */
export async function reconcilePrimaryWalletCardCheckoutWebhook(input: {
  body: unknown;
  runtime?: unknown;
  execute?: Executor;
  provider?: Provider;
}): Promise<Response | null> {
  const body = object(input.body);
  const data = body ? object(body.data) : null;
  const metadata = metadataOf(input.body);
  const reference =
    data && typeof data.reference === 'string' ? data.reference : null;
  const operationId =
    metadata && typeof metadata.operation_id === 'string'
      ? metadata.operation_id
      : null;
  const email =
    data &&
    object(data.customer) &&
    typeof object(data.customer)?.email === 'string'
      ? (object(data.customer)?.email as string)
      : null;
  if (!reference || !operationId || !email) return null;
  if (reference !== `pvb-first-primary-${operationId}`) return null;
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
    metadata?.integration_id !== runtime.settings.integrationId ||
    metadata?.merchant_id !== runtime.settings.merchantId ||
    metadata?.environment !== runtime.settings.environment
  )
    return null;
  try {
    const service = createPrimaryWalletCardCheckoutService({
      settings: runtime.settings,
      scope: {
        environment: runtime.settings.environment,
        integrationId: runtime.settings.integrationId,
        merchantId: runtime.settings.merchantId,
        customerId: metadata?.customer_id,
        userId: metadata?.user_id,
        businessId: runtime.settings.businessId,
        email,
      },
      execute:
        input.execute ?? createPrimaryWalletCardCheckoutExecutor(runtime),
      provider:
        input.provider ??
        createPrimaryWalletCardCheckoutProvider(runtime.settings, fetch),
    });
    const result = await service.status(operationId);
    // Terminal abandonment acks: the outcome is durable and redelivery
    // can never change it, so returning null would 503 forever on the
    // retry boundary. Non-terminal states stay null (retryable).
    if (
      ![
        'custody_pending',
        'reconciliation_required',
        'completed',
        'abandoned',
      ].includes(result.status)
    )
      return null;
    return Response.json(
      { received: true },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return null;
  }
}
