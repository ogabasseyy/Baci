import { piggyvestScheduleReviewSchemas as schemas } from '../contracts/piggyvest-schedule-review';
import { piggyvestPolicyClientSchemas } from '../schemas/piggyvest-policy-client';
import { createPiggyvestCustomerClientRequest } from './piggyvest-customer-client-request';

export function createPiggyvestScheduleClient(options: {
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
  return {
    async read(operationId?: unknown, signal?: AbortSignal) {
      try {
        const query = schemas.read.parse({
          goalId,
          ...(operationId === undefined ? {} : { operationId }),
        });
        const result = schemas.snapshot.parse(
          await request(
            { method: 'GET', endpointPath: config.endpointPath, query },
            signal
          )
        );
        if (
          result.goalId !== goalId ||
          (result.historical &&
            (result.historical.receipt.operationId !== query.operationId ||
              result.historical.command.goalId !== goalId))
        )
          throw new Error();
        return result;
      } catch {
        throw new Error('Schedule unavailable');
      }
    },
    async submit(input: unknown, signal?: AbortSignal) {
      try {
        const body = schemas.request.parse(input);
        if (body.command.goalId !== goalId) throw new Error();
        const result = schemas.result.parse(
          await request(
            { method: 'POST', endpointPath: config.endpointPath, body },
            signal
          )
        );
        if (
          result.goalId !== goalId ||
          (result.status === 'persisted_proposal'
            ? result.receipt.operationId
            : result.operationId) !== body.operationId
        )
          throw new Error();
        return result;
      } catch {
        throw new Error('Schedule unavailable');
      }
    },
  };
}
