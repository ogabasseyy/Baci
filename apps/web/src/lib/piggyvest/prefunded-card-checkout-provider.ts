import 'server-only';
import { prefundedCardCheckoutSchemas as checkoutSchemas } from '@/schemas/prefunded-card-checkout';
import { prefundedCardCheckoutProviderResponseSchemas as responseSchemas } from '@/schemas/prefunded-card-checkout-provider';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';

const PAYSTACK_ORIGIN = 'https://api.paystack.co';
const GENERIC_ERROR = 'PREFUNDED_CARD_PROVIDER_UNAVAILABLE';

type Intent = ReturnType<typeof checkoutSchemas.intent.parse>;
type Settings = ReturnType<typeof checkoutSchemas.providerSettings.parse>;
type Collection = ReturnType<typeof checkoutSchemas.collection.parse>;
type Session = ReturnType<typeof checkoutSchemas.session.parse>;
type Verification =
  | { outcome: 'verified'; collection: Collection }
  | { outcome: 'pending' }
  | { outcome: 'reconciliation_required' };

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function transactionId(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value))
    return null;
  try {
    return BigInt(value) <= 18_446_744_073_709_551_615n ? value : null;
  } catch {
    return null;
  }
}

function validateIntent(
  input: unknown,
  settings: Settings,
  now: () => number
): Intent {
  const intent = checkoutSchemas.intent.parse(input);
  const scope = settings;
  const nowValue = now();
  if (
    intent.deployment !== scope.deployment ||
    intent.integrationId !== scope.integrationId ||
    intent.merchantId !== scope.merchantId ||
    intent.treasuryBindingId !== scope.treasuryBindingId ||
    intent.businessId !== scope.businessId ||
    intent.systemIdentifier !== scope.systemIdentifier ||
    intent.expiresAt !== scope.expiresAt ||
    intent.currency !== 'NGN' ||
    intent.reference !== `pvb-first-${intent.intentId}` ||
    !Number.isFinite(nowValue) ||
    nowValue >= Date.parse(intent.expiresAt)
  ) {
    throw new Error(GENERIC_ERROR);
  }
  return intent;
}

function metadataMatches(value: unknown, intent: Intent): boolean {
  const metadata = object(value);
  return Boolean(
    metadata &&
      metadata.transaction_type === 'prefunded_first_card' &&
      metadata.intent_id === intent.intentId &&
      metadata.customer_id === intent.customerId &&
      metadata.merchant_id === intent.merchantId &&
      metadata.integration_id === intent.integrationId &&
      metadata.goal_id === intent.goalId &&
      metadata.request_fingerprint === intent.requestFingerprint
  );
}

export function createPrefundedCardCheckoutProvider({
  settings,
  fetchImplementation,
  now = Date.now,
}: {
  settings: unknown;
  fetchImplementation: typeof fetch;
  now?: () => number;
}) {
  let configured: Settings;
  try {
    configured = checkoutSchemas.providerSettings.parse(settings);
  } catch {
    throw new Error(GENERIC_ERROR);
  }

  return {
    async initialize(input: unknown): Promise<Session> {
      try {
        const intent = validateIntent(input, configured, now);
        const response = responseSchemas.initialize.parse(
          await requestPrefundedCardProviderJson({
            url: `${PAYSTACK_ORIGIN}/transaction/initialize`,
            token: configured.paystackSecret,
            timeoutMs: 5_000,
            maxResponseBytes: 65_536,
            fetchImplementation,
            init: {
              method: 'POST',
              body: JSON.stringify({
                amount: String(intent.amountKobo),
                email: intent.email,
                currency: 'NGN',
                reference: intent.reference,
                channels: ['card'],
                callback_url: configured.callbackUrl,
                metadata: {
                  transaction_type: 'prefunded_first_card',
                  intent_id: intent.intentId,
                  customer_id: intent.customerId,
                  merchant_id: intent.merchantId,
                  integration_id: intent.integrationId,
                  goal_id: intent.goalId,
                  request_fingerprint: intent.requestFingerprint,
                },
              }),
            },
          })
        );
        const data = object(response.data);
        const url = text(data?.authorization_url);
        const accessCode = text(data?.access_code);
        if (
          response.status !== true ||
          data?.reference !== intent.reference ||
          !url ||
          !accessCode ||
          !/^https:\/\/checkout\.paystack\.com\/[A-Za-z0-9]+$/.test(url) ||
          url.split('/').at(-1) !== accessCode
        ) {
          throw new Error(GENERIC_ERROR);
        }
        return checkoutSchemas.session.parse({
          reference: intent.reference,
          authorizationUrl: url,
        });
      } catch {
        throw new Error(GENERIC_ERROR);
      }
    },
    async verify(input: unknown): Promise<Verification> {
      let intent: Intent;
      try {
        intent = validateIntent(input, configured, now);
      } catch {
        throw new Error(GENERIC_ERROR);
      }
      try {
        let rawResponse: unknown;
        try {
          rawResponse = await requestPrefundedCardProviderJson({
            url: `${PAYSTACK_ORIGIN}/transaction/verify/${encodeURIComponent(intent.reference)}`,
            token: configured.paystackSecret,
            timeoutMs: 5_000,
            maxResponseBytes: 65_536,
            fetchImplementation,
            init: { method: 'GET' },
          });
        } catch {
          return { outcome: 'pending' };
        }
        const response = responseSchemas.verify.parse(rawResponse);
        const data = object(response.data);
        const customer = object(data?.customer);
        if (
          data?.domain !== 'test' ||
          data.amount !== intent.amountKobo ||
          data.currency !== 'NGN' ||
          data.reference !== intent.reference ||
          customer?.email !== intent.email ||
          !metadataMatches(data.metadata, intent)
        ) {
          return { outcome: 'reconciliation_required' };
        }
        if (response.status !== true)
          return { outcome: 'reconciliation_required' };
        const status = text(data.status);
        if (
          status === 'abandoned' ||
          status === 'pending' ||
          status === 'ongoing' ||
          status === 'processing' ||
          status === 'queued'
        ) {
          return { outcome: 'pending' };
        }
        if (status !== 'success') return { outcome: 'reconciliation_required' };

        const authorization = object(data.authorization);
        const providerTransactionId = transactionId(data.id);
        if (
          data.channel !== 'card' ||
          authorization?.channel !== 'card' ||
          authorization?.reusable !== true ||
          !providerTransactionId
        ) {
          return { outcome: 'reconciliation_required' };
        }
        const collection = checkoutSchemas.collection.parse({
          intentId: intent.intentId,
          reference: intent.reference,
          providerTransactionId,
          amountKobo: intent.amountKobo,
          currency: 'NGN',
          domain: 'test',
          authorization: {
            authorizationCode: authorization.authorization_code,
            signature: authorization.signature,
            customerCode: customer?.customer_code,
            email: customer?.email,
            reusable: true,
            brand: authorization.brand,
            last4: authorization.last4,
            expiryMonth: authorization.exp_month,
            expiryYear: authorization.exp_year,
          },
        });
        return { outcome: 'verified', collection };
      } catch {
        return { outcome: 'reconciliation_required' };
      }
    },
  };
}
