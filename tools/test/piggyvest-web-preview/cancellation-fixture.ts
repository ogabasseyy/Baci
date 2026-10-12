import { piggyvestCancellationReviewSchemas as schemas } from '../../../packages/shared/src/contracts/piggyvest-cancellation-review';

export function createCancellationFixture(
  goal: 'a' | 'b',
  result: 'prepared' | 'uncertain'
) {
  const suffix = goal === 'a' ? '000000000001' : '000000000002';
  const goalId = `30000000-0000-4000-8000-${suffix}`;
  const operationId = `80000000-0000-4000-8000-${suffix}`;
  const assertions = {
    goalId,
    revisionId: `70000000-0000-4000-8000-${suffix}`,
    termsVersion: 'synthetic-cancellation-v1',
    termsHash: 'a'.repeat(64),
    consentVersion: '2026-09-11' as const,
    principalKobo: 10000,
    paidInterestKobo: 700,
    pendingInterestKobo: 300,
  };
  const quote = {
    status: 'quote_available' as const,
    ...assertions,
    interestDisposition: 'unresolved' as const,
    dispatch: 'contract_gap' as const,
  };
  schemas.quote.parse(quote);
  return {
    quote,
    operationId,
    async prepare(input: unknown) {
      const confirmation = schemas.confirmation.parse(input);
      const expected = schemas.confirmation.parse({
        ...assertions,
        operationId,
        accepted: true,
      });
      for (const field of Object.keys(expected) as (keyof typeof expected)[]) {
        if (confirmation[field] !== expected[field]) {
          throw new Error('Synthetic cancellation confirmation mismatch');
        }
      }
      return await Promise.resolve(
        schemas.receipt.parse(
          result === 'prepared'
            ? {
                status: 'prepared',
                goalId,
                operationId,
                collectionPaused: true,
                dispatch: 'contract_gap',
                interestDisposition: 'unresolved',
              }
            : {
                status: 'unavailable',
                goalId,
                operationId,
                reservation: 'may_be_retained',
                dispatch: 'contract_gap',
              }
        )
      );
    },
  };
}
