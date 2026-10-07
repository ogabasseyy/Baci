import 'server-only';
import { prefundedCardClaimedRequestSchema } from '@/schemas/prefunded-card-claimed-request';
import { prefundedCardProviderSchemas as schemas } from '@/schemas/prefunded-card-provider';
import { prefundedCardTransferVerificationSchemas } from '@/schemas/prefunded-card-transfer-verification';
import { collectPrefundedCardTransferProof } from './collect-prefunded-card-transfer-proof';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';

const PAYSTACK_ORIGIN = 'https://api.paystack.co';
const PIGGYVEST_STAGING_ORIGIN = 'https://staging.piggyvest.business';
const PAYSTACK_REFERENCE = /^[A-Za-z0-9.=-]+$/;

type ClaimedRequest = ReturnType<
  typeof prefundedCardClaimedRequestSchema.parse
>;
type SavedMethod = ReturnType<typeof schemas.savedMethod.parse>;

type Verification =
  | { outcome: 'verified_success'; evidence: Record<string, unknown> }
  | { outcome: 'verified_failed'; evidence: Record<string, unknown> }
  | { outcome: 'deferred' }
  | { outcome: 'reconciliation_required' };

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function paystackTransactionId(value: unknown): string | null {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value))
    return null;
  try {
    return BigInt(value) <= 18_446_744_073_709_551_615n ? value : null;
  } catch {
    return null;
  }
}

function matchesSavedMethod(
  response: Record<string, unknown>,
  claim: ClaimedRequest,
  savedMethod: SavedMethod
): Record<string, unknown> | null {
  const data = object(response.data);
  const customer = data && object(data.customer);
  const authorization = data && object(data.authorization);
  if (
    !data ||
    text(data.domain) !== 'test' ||
    text(data.reference) !== claim.collectionReference ||
    number(data.amount) !== claim.amountKobo ||
    text(data.currency) !== claim.currency ||
    text(customer?.customer_code) !== savedMethod.paystackCustomerCode ||
    text(customer?.email) !== savedMethod.email ||
    text(authorization?.authorization_code) !== savedMethod.authorizationCode
  ) {
    return null;
  }
  const transactionId = paystackTransactionId(data.id);
  if (!transactionId) return null;
  return {
    reference: claim.collectionReference,
    amountKobo: claim.amountKobo,
    currency: claim.currency,
    savedMethodId: claim.savedMethodId,
    providerTransactionId: transactionId,
  };
}

export function createPrefundedCardProvider({
  settings,
  fetchImplementation,
  resolveSavedMethod,
  verifyStoredTransfer,
  expectedSystemIdentifier,
  resolveTransferOwnership,
}: {
  settings: unknown;
  fetchImplementation: typeof fetch;
  resolveSavedMethod: (identity: {
    savedMethodId: string;
    merchantId: string;
    customerId: string;
  }) => Promise<unknown>;
  verifyStoredTransfer?: (claim: ClaimedRequest) => Promise<Verification>;
  expectedSystemIdentifier?: string;
  resolveTransferOwnership?: (claim: ClaimedRequest) => Promise<unknown>;
}) {
  const configured = schemas.settings.parse(settings);
  const resolve = async (claim: ClaimedRequest, forSubmission: boolean) => {
    const method = schemas.savedMethod.parse(
      await resolveSavedMethod({
        savedMethodId: claim.savedMethodId,
        merchantId: claim.merchantId,
        customerId: claim.customerId,
      })
    );
    if (
      method.savedMethodId !== claim.savedMethodId ||
      method.merchantId !== claim.merchantId ||
      method.customerId !== claim.customerId ||
      (forSubmission && (!method.reusable || !method.active))
    ) {
      throw new Error('SAVED_METHOD_IDENTITY_MISMATCH');
    }
    return method;
  };
  const validScope = (claim: ClaimedRequest) =>
    claim.integrationId === configured.scope.integrationId &&
    claim.merchantId === configured.scope.merchantId &&
    claim.treasuryBindingId === configured.scope.treasuryBindingId &&
    claim.sourceWalletId === configured.scope.sourceWalletId &&
    claim.businessId === configured.piggyvest.expectedBusinessId &&
    claim.currency === configured.piggyvest.expectedCurrency;

  return {
    async submitCollection(input: unknown) {
      const claim = prefundedCardClaimedRequestSchema.parse(input);
      if (
        !validScope(claim) ||
        !PAYSTACK_REFERENCE.test(claim.collectionReference)
      )
        return { outcome: 'reconciliation_required' } as const;
      const method = await resolve(claim, true);
      const response = object(
        await requestPrefundedCardProviderJson({
          url: `${PAYSTACK_ORIGIN}/transaction/charge_authorization`,
          token: configured.paystackSecret,
          timeoutMs: configured.paystackTimeoutMs,
          maxResponseBytes: configured.piggyvest.maxResponseBytes,
          fetchImplementation,
          init: {
            method: 'POST',
            body: JSON.stringify({
              amount: String(claim.amountKobo),
              authorization_code: method.authorizationCode,
              currency: claim.currency,
              email: method.email,
              reference: claim.collectionReference,
            }),
          },
        })
      );
      if (response?.status !== true) throw new Error('PAYSTACK_REJECTED');
      return { outcome: 'submitted_for_verification' } as const;
    },
    async submitTransfer(input: unknown) {
      const claim = prefundedCardClaimedRequestSchema.parse(input);
      if (!validScope(claim))
        return { outcome: 'reconciliation_required' } as const;
      const response = object(
        await requestPrefundedCardProviderJson({
          url: `${PIGGYVEST_STAGING_ORIGIN}/api/v1/transfer/wallet`,
          token: configured.piggyvest.apiSecret,
          timeoutMs: configured.piggyvest.timeoutMs,
          maxResponseBytes: configured.piggyvest.maxResponseBytes,
          fetchImplementation,
          init: {
            method: 'POST',
            body: JSON.stringify({
              amount: claim.amountKobo,
              source: claim.sourceWalletId,
              destination: claim.destinationWalletId,
              currency: claim.currency,
              reference: claim.transferReference,
            }),
          },
        })
      );
      if (response?.status !== true) throw new Error('PIGGYVEST_REJECTED');
      return { outcome: 'submitted_for_verification' } as const;
    },
    async verifyCollection(input: unknown): Promise<Verification> {
      const claim = prefundedCardClaimedRequestSchema.parse(input);
      if (!validScope(claim)) return { outcome: 'reconciliation_required' };
      const method = await resolve(claim, false);
      const response = object(
        await requestPrefundedCardProviderJson({
          url: `${PAYSTACK_ORIGIN}/transaction/verify/${encodeURIComponent(claim.collectionReference)}`,
          token: configured.paystackSecret,
          timeoutMs: configured.paystackTimeoutMs,
          maxResponseBytes: configured.piggyvest.maxResponseBytes,
          fetchImplementation,
          init: { method: 'GET' },
        })
      );
      if (response?.status !== true)
        return { outcome: 'reconciliation_required' };
      const evidence = response && matchesSavedMethod(response, claim, method);
      if (!evidence) return { outcome: 'reconciliation_required' };
      const status = text(object(response.data)?.status);
      if (status === 'success')
        return { outcome: 'verified_success', evidence };
      if (status === 'failed') return { outcome: 'verified_failed', evidence };
      return ['pending', 'ongoing', 'processing', 'queued'].includes(
        status ?? ''
      )
        ? { outcome: 'deferred' }
        : { outcome: 'reconciliation_required' };
    },
    async verifyTransfer(input: unknown): Promise<Verification> {
      const claim = prefundedCardClaimedRequestSchema.parse(input);
      if (!validScope(claim)) return { outcome: 'reconciliation_required' };
      if (verifyStoredTransfer) {
        const stored = await verifyStoredTransfer(claim);
        if (stored.outcome === 'verified_success') {
          const evidence = stored.evidence;
          if (
            evidence.reference !== claim.transferReference ||
            evidence.amountKobo !== claim.amountKobo ||
            evidence.currency !== claim.currency ||
            evidence.businessId !== claim.businessId ||
            evidence.sourceWalletId !== claim.sourceWalletId ||
            evidence.destinationWalletId !== claim.destinationWalletId ||
            evidence.destinationCustomerId !== claim.destinationCustomerId ||
            !prefundedCardTransferVerificationSchemas.identifier.safeParse(
              evidence.providerTransactionId
            ).success
          )
            return { outcome: 'reconciliation_required' };
          return stored;
        }
        if (stored.outcome !== 'deferred')
          return { outcome: 'reconciliation_required' };
      }
      return collectPrefundedCardTransferProof({
        settings: configured,
        claim,
        fetchImplementation,
        expectedSystemIdentifier,
        resolveOwnership:
          resolveTransferOwnership &&
          (async (selected) => {
            const proof =
              prefundedCardTransferVerificationSchemas.runtimeOwnership.safeParse(
                await resolveTransferOwnership(selected)
              );
            return proof.success ? proof.data : null;
          }),
      });
    },
  };
}
