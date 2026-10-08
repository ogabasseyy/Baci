import 'server-only';
import { prefundedCardAuthorizationResolverSchemas as schemas } from '@/schemas/prefunded-card-authorization-resolver';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';

type Execute = (
  statement: string,
  parameters: readonly string[]
) => Promise<{ rows: unknown }>;

export function createPrefundedCardAuthorizationResolver({
  execute,
  scope,
  verification,
}: {
  execute: Execute;
  scope: unknown;
  verification?: { paystackSecret: unknown; fetchImplementation: typeof fetch };
}) {
  const configured = schemas.scope.safeParse(scope);
  if (!configured.success || typeof execute !== 'function') {
    throw new Error('Prefunded card authorization unavailable');
  }
  const pins = configured.data;
  const parametersFor = (
    identity: ReturnType<typeof schemas.identity.parse>
  ) => {
    if (identity.merchantId !== pins.merchantId) {
      throw new Error('Prefunded card authorization unavailable');
    }
    return [
      pins.treasuryBindingId,
      pins.integrationId,
      identity.merchantId,
      identity.customerId,
      identity.savedMethodId,
    ];
  };

  return {
    async resolveSavedMethod(input: unknown) {
      try {
        const identity = schemas.identity.parse(input);
        const response = await execute(
          'SELECT prefunded_card.read_authorization($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text) AS result',
          [...parametersFor(identity), pins.systemIdentifier]
        );
        const result = schemas.readRows.parse(response.rows)[0].result;
        if (
          result.savedMethodId !== identity.savedMethodId ||
          result.merchantId !== identity.merchantId ||
          result.customerId !== identity.customerId
        ) {
          throw new Error('Prefunded card authorization unavailable');
        }
        return Object.freeze(result);
      } catch {
        throw new Error('Prefunded card authorization unavailable');
      }
    },
    async provision(input: unknown) {
      try {
        const request = schemas.provision.parse(input);
        const verifiedSettings = schemas.verification.parse({
          paystackSecret: verification?.paystackSecret,
        });
        if (
          !verification ||
          typeof verification.fetchImplementation !== 'function'
        ) {
          throw new Error('Prefunded card authorization unavailable');
        }
        const parameters = [
          ...parametersFor(request),
          request.transactionId,
          pins.systemIdentifier,
        ];
        const candidateResponse = await execute(
          'SELECT prefunded_card.authorization_candidate($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::text) AS result',
          parameters
        );
        const candidate = schemas.candidateRows.parse(candidateResponse.rows)[0]
          .result;
        if (
          candidate.savedMethodId !== request.savedMethodId ||
          candidate.merchantId !== request.merchantId ||
          candidate.customerId !== request.customerId ||
          candidate.transactionId !== request.transactionId
        ) {
          throw new Error('Prefunded card authorization unavailable');
        }
        const receipt = schemas.verifiedReceipt.parse(
          await requestPrefundedCardProviderJson({
            url: `https://api.paystack.co/transaction/verify/${encodeURIComponent(candidate.reference)}`,
            token: verifiedSettings.paystackSecret,
            timeoutMs: 5_000,
            maxResponseBytes: 65_536,
            fetchImplementation: async (url, init) => {
              const response = await verification.fetchImplementation(
                url,
                init
              );
              if (response.status !== 200)
                throw new Error('PROVIDER_HTTP_ERROR');
              return response;
            },
            init: { method: 'GET' },
          })
        ).data;
        if (
          receipt.reference !== candidate.reference ||
          receipt.amount !== candidate.amountKobo ||
          receipt.customer.email !== candidate.email ||
          receipt.authorization.authorization_code !==
            candidate.authorizationCode ||
          receipt.authorization.signature !== candidate.signature ||
          receipt.metadata.customer_id !== candidate.customerId ||
          receipt.metadata.merchant_slug !== candidate.merchantSlug
        ) {
          throw new Error('Prefunded card authorization unavailable');
        }
        const response = await execute(
          'SELECT prefunded_card.provision_authorization($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::text,$8::jsonb) AS result',
          [...parameters, JSON.stringify(receipt)]
        );
        const result = schemas.provisionRows.parse(response.rows)[0].result;
        if (
          result.savedMethodId !== request.savedMethodId ||
          result.transactionId !== request.transactionId
        ) {
          throw new Error('Prefunded card authorization unavailable');
        }
        return result;
      } catch {
        throw new Error('Prefunded card authorization unavailable');
      }
    },
  };
}
