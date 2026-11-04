import 'server-only';
import {
  type OxygenProvider,
  OxygenProviderFailure,
  type OxygenProviderOperation,
} from './provider';

/** A successful mutation followed by a failed read/write is still uncertain.
 * Reads and definite rejections must not permanently lock the customer's flow. */
export function trackOxygenExecution(provider: OxygenProvider) {
  let uncertain = false;
  let operation: OxygenProviderOperation | null = null;
  // Oxygen documents /loan-request/get as eligibility status retrieval for an
  // existing application. Repeating this read cannot authorize a booking.
  const reads = new Set(['kyc', 'details', 'payment', 'eligibility']);
  return {
    uncertain: () => uncertain,
    operation: () => operation,
    responseMetadata: () => provider.responseMetadata?.(),
    provider: {
      environment: provider.environment,
      async call(nextOperation, input) {
        operation = nextOperation;
        const mutation = !reads.has(operation);
        const before = uncertain;
        if (mutation) uncertain = true;
        try {
          return await provider.call(operation, input);
        } catch (error) {
          if (
            mutation &&
            error instanceof OxygenProviderFailure &&
            (error.outcome === 'not_sent' || error.outcome === 'rejected')
          )
            uncertain = before;
          throw error;
        }
      },
    } satisfies OxygenProvider,
  };
}
