import 'server-only';
import { prefundedCardCheckoutProviderResponseSchemas as responses } from '@/schemas/prefunded-card-checkout-provider';
import { primaryWalletCardCheckoutSchemas as schemas } from '@/schemas/primary-wallet-card-checkout';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function createPrimaryWalletCardCheckoutProvider(
  settings: unknown,
  fetchImplementation: typeof fetch,
  now = Date.now
) {
  const config = schemas.settings.parse(settings);
  const select = (input: unknown) => {
    const intent = schemas.intent.parse(input);
    if (
      intent.environment !== config.environment ||
      intent.integrationId !== config.integrationId ||
      intent.merchantId !== config.merchantId ||
      intent.businessId !== config.businessId ||
      !Number.isFinite(now()) ||
      now() >= Date.parse(config.expiresAt)
    )
      throw new Error('Primary card provider unavailable');
    return intent;
  };
  const metadataFor = (intent: ReturnType<typeof select>) => ({
    transaction_type: 'primary_wallet_card_checkout',
    operation_id: intent.operationId,
    integration_id: intent.integrationId,
    merchant_id: intent.merchantId,
    customer_id: intent.customerId,
    user_id: intent.userId,
    environment: intent.environment,
    request_fingerprint: intent.fingerprint,
  });
  const request = (path: string, init: RequestInit) =>
    requestPrefundedCardProviderJson({
      url: `https://api.paystack.co${path}`,
      token: config.paystackSecret,
      timeoutMs: 5000,
      maxResponseBytes: 65536,
      fetchImplementation,
      init,
    });
  return {
    async initialize(input: unknown) {
      try {
        const intent = select(input);
        const response = responses.initialize.parse(
          await request('/transaction/initialize', {
            method: 'POST',
            body: JSON.stringify({
              amount: String(intent.amountKobo),
              email: intent.email,
              currency: 'NGN',
              reference: intent.reference,
              channels: ['card'],
              callback_url: config.callbackUrl,
              metadata: metadataFor(intent),
            }),
          })
        );
        const data = object(response.data);
        const session = schemas.session.parse({
          reference: data?.reference,
          authorizationUrl: data?.authorization_url,
        });
        // Correlate the access code against the checkout path's last
        // segment: a raw split comparison breaks when the provider URL
        // carries extra segments or a query string.
        const checkoutCode = new URL(session.authorizationUrl).pathname
          .split('/')
          .filter(Boolean)
          .at(-1);
        if (
          !response.status ||
          session.reference !== intent.reference ||
          checkoutCode !== data?.access_code
        )
          throw new Error('Invalid session');
        return session;
      } catch {
        throw new Error('Primary card provider unavailable');
      }
    },
    async verify(input: unknown) {
      const intent = select(input);
      let raw: unknown;
      try {
        raw = await request(
          `/transaction/verify/${encodeURIComponent(intent.reference)}`,
          { method: 'GET' }
        );
      } catch {
        return { outcome: 'pending' as const };
      }
      try {
        const response = responses.verify.parse(raw);
        const data = object(response.data);
        const customer = object(data?.customer);
        let metadata = data?.metadata;
        if (typeof metadata === 'string') metadata = JSON.parse(metadata);
        const actualMetadata = object(metadata);
        const expectedMetadata = metadataFor(intent);
        if (
          !response.status ||
          !data ||
          data.reference !== intent.reference ||
          data.amount !== intent.amountKobo ||
          data.currency !== 'NGN' ||
          data.domain !==
            (config.environment === 'production' ? 'live' : 'test') ||
          customer?.email !== intent.email ||
          !actualMetadata ||
          Object.entries(expectedMetadata).some(
            ([key, value]) => actualMetadata[key] !== value
          )
        )
          return { outcome: 'reconciliation_required' as const };
        // Authoritatively dead checkouts terminalize: Paystack will never
        // complete an abandoned or failed transaction, so preserving them
        // would pin the customer to a dead checkout with no path to retry.
        // (Evidence mismatches above still route to reconciliation.)
        if (
          String(data.status) === 'abandoned' ||
          String(data.status) === 'failed'
        )
          return { outcome: 'abandoned' as const };
        if (
          ['pending', 'ongoing', 'processing', 'queued'].includes(
            String(data.status)
          )
        )
          return { outcome: 'pending' as const };
        if (data.status !== 'success' || data.channel !== 'card')
          return { outcome: 'reconciliation_required' as const };
        const authorization = object(data.authorization);
        const token =
          intent.consent.saveCard && authorization?.channel === 'card'
            ? schemas.token.safeParse({
                authorizationCode: authorization.authorization_code,
                customerCode: customer?.customer_code,
                email: customer?.email,
                reusable: authorization.reusable,
              })
            : null;
        const collection = schemas.collection.parse({
          reference: intent.reference,
          amountKobo: intent.amountKobo,
          domain: data.domain,
          providerTransactionId:
            typeof data.id === 'number' && Number.isSafeInteger(data.id)
              ? String(data.id)
              : data.id,
          token: token?.success ? token.data : null,
        });
        return { outcome: 'verified' as const, collection };
      } catch {
        return { outcome: 'reconciliation_required' as const };
      }
    },
  };
}
