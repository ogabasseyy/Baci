import { piggyvestDraftClosureSchemas as schemas } from '../contracts/piggyvest-draft-closure';
import { piggyvestPolicyClientSchemas } from '../schemas/piggyvest-policy-client';
import { createPiggyvestCustomerClientRequest } from './piggyvest-customer-client-request';

export function createPiggyvestDraftClosureClient(options: {
  configuration: unknown;
  goalId: unknown;
  fetch: typeof globalThis.fetch;
  getCsrfToken: (signal: AbortSignal) => Promise<string>;
  isCurrent: () => boolean;
}) {
  const config = piggyvestPolicyClientSchemas.configuration.parse(
    options.configuration
  );
  const goalId = schemas.read.shape.goalId.parse(options.goalId);
  const request = createPiggyvestCustomerClientRequest({
    ...options,
    configuration: {
      mode: config.mode,
      baseUrl: config.baseUrl,
      credentials: config.credentials,
      endpointPaths: [config.endpointPath],
    },
  });
  const same = (left: string, right: string) =>
    left.toLowerCase() === right.toLowerCase();
  return {
    async read(signal?: AbortSignal) {
      try {
        const result = schemas.response.parse(
          await request(
            {
              method: 'GET',
              endpointPath: config.endpointPath,
              query: { goalId },
            },
            signal
          )
        );
        if (!same(result.goalId, goalId)) throw new Error();
        return result;
      } catch {
        throw new Error('Plan closure unavailable');
      }
    },
    async close(input: unknown, signal?: AbortSignal) {
      try {
        const body = schemas.close.parse(input);
        if (!same(body.goalId, goalId)) throw new Error();
        const result = schemas.response.parse(
          await request(
            { method: 'POST', endpointPath: config.endpointPath, body },
            signal
          )
        );
        if (
          result.status !== 'closed' ||
          !same(result.goalId, goalId) ||
          !same(result.operationId, body.operationId) ||
          !same(result.revisionId, body.revisionId) ||
          result.termsHash !== body.termsHash ||
          result.termsVersion !== body.termsVersion
        )
          throw new Error();
        return result;
      } catch {
        throw new Error('Plan closure unavailable');
      }
    },
  };
}
