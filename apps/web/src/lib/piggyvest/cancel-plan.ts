import 'server-only';
import { cancelPlanSchemas as schemas } from '@/schemas/cancel-plan';
import { CANCEL_PLAN_STATEMENTS } from './cancel-plan-statements';
import { evaluateSavingsPolicy } from './savings-policy';

export function createCancelPlan({
  configuration,
  execute,
}: {
  configuration: unknown;
  execute: (
    statement: string,
    parameters: readonly string[]
  ) => Promise<{ rows: unknown }>;
}) {
  const parsed = schemas.configuration.safeParse(configuration);
  if (!parsed.success || typeof execute !== 'function') {
    throw new Error('Cancellation preparation unavailable');
  }
  const scope = parsed.data;
  const parameters = [
    scope.integrationId,
    scope.merchantId,
    scope.customerId,
    scope.goalId,
    scope.expectedBusinessId,
  ];
  return {
    async quote() {
      try {
        const response = await execute(
          CANCEL_PLAN_STATEMENTS.quoteCancelPlan.text,
          [...parameters, scope.actorId]
        );
        const source = schemas.source.parse(response.rows)[0].result;
        if ('status' in source) return source;
        const { policy, ledgerSnapshot } = source;
        if (
          policy.actorId !== scope.actorId ||
          !policy.acceptedAt ||
          ledgerSnapshot.fundingReversed ||
          ledgerSnapshot.activeReservation
        ) {
          return { status: 'unavailable' } as const;
        }
        const device = {
          productId: policy.command.productId,
          variantId: policy.command.variantId,
          condition: policy.device.condition,
        };
        const decision = evaluateSavingsPolicy({
          policyVersion: '2026-09-11',
          now: policy.acceptedAt,
          goalState: policy.command.lifecycle,
          requestedAction: 'cancel',
          collectionPaused: policy.command.collectionPaused,
          hasBeforeFundingConsent: true,
          cancellationInterestForfeitureConsentVersion: '2026-09-11',
          device,
          ledger: ledgerSnapshot.ledger,
          activationQuote: null,
          currentOffer: { device, priceKobo: policy.command.quoteKobo },
          guarantee: null,
          reservation: 'none',
        }).cancellation;
        if (
          decision.status !== 'quote_available' ||
          !decision.principalRefundKobo
        ) {
          return { status: 'unavailable' } as const;
        }
        return {
          status: 'quote_available' as const,
          revisionId: policy.revisionId,
          termsVersion: policy.command.termsVersion,
          termsHash: policy.command.termsHash,
          consentVersion: '2026-09-11' as const,
          principalKobo: decision.principalRefundKobo,
          paidInterestKobo: decision.paidInterestForfeitureKobo,
          pendingInterestKobo: decision.pendingInterestCancelledKobo,
          interestDisposition: 'unresolved' as const,
          dispatch: 'contract_gap' as const,
        };
      } catch {
        return { status: 'unavailable' } as const;
      }
    },
    async prepare(input: unknown) {
      try {
        const confirmation = schemas.confirmation.parse(input);
        if (confirmation.actorId !== scope.actorId)
          throw new Error('Actor mismatch');
        const response = await execute(
          CANCEL_PLAN_STATEMENTS.prepareCancelPlan.text,
          [...parameters, JSON.stringify(confirmation)]
        );
        const receipt = schemas.prepared.parse(response.rows)[0].result;
        if (receipt.operationId !== confirmation.operationId)
          throw new Error('Operation mismatch');
        return receipt;
      } catch {
        return {
          status: 'unavailable',
          reservation: 'may_be_retained',
          dispatch: 'contract_gap',
        } as const;
      }
    },
    dispatch() {
      return {
        status: 'contract_gap',
        reason: 'provider_cancellation_mechanism_unverified',
      } as const;
    },
  };
}
