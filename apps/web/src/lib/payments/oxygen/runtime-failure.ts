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
  const reads = new Set(['kyc', 'eligibility', 'details', 'payment']);
  return {
    uncertain: () => uncertain,
    operation: () => operation,
    provider: {
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
            error.outcome !== 'indeterminate'
          )
            uncertain = before;
          throw error;
        }
      },
    } satisfies OxygenProvider,
  };
}
