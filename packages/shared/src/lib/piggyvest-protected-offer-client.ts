import { piggyvestProtectedOfferSchemas as schemas } from '../contracts/piggyvest-protected-offer';
import { piggyvestPolicyClientSchemas } from '../schemas/piggyvest-policy-client';
import { createPiggyvestCustomerClientRequest } from './piggyvest-customer-client-request';

export function createPiggyvestProtectedOfferClient(
  options: Parameters<typeof createPiggyvestCustomerClientRequest>[0] & {
    goalId: unknown;
  }
) {
  const config = piggyvestPolicyClientSchemas.configuration.parse(
    options.configuration
  );
  const goalId = schemas.request.shape.goalId
    .parse(options.goalId)
    .toLowerCase();
  const paths = {
    publish: `${config.endpointPath}/publish`,
    status: `${config.endpointPath}/status`,
  };
  let viewGuard = () => true;
  const request = createPiggyvestCustomerClientRequest({
    ...options,
    isCurrent: () => options.isCurrent() === true && viewGuard() === true,
    configuration: {
      mode: config.mode,
      baseUrl: config.baseUrl,
      credentials: config.credentials,
      endpointPaths: Object.values(paths),
    },
  });
  return {
    setViewGuard(guard: () => boolean) {
      viewGuard = guard;
    },
    async publish(input: unknown, signal?: AbortSignal) {
      try {
        const body = schemas.request.parse(input);
        if (body.goalId.toLowerCase() !== goalId) throw new Error();
        const result = schemas.published.parse(
          await request(
            { method: 'POST', endpointPath: paths.publish, body },
            signal
          )
        );
        if (result.receipt.goalId.toLowerCase() !== goalId) throw new Error();
        return result;
      } catch {
        throw new Error('Protected offer unavailable');
      }
    },
    async status(input: unknown, signal?: AbortSignal) {
      try {
        const query = schemas.request.parse(input);
        if (query.goalId.toLowerCase() !== goalId) throw new Error();
        const result = schemas.observation.parse(
          await request(
            { method: 'GET', endpointPath: paths.status, query },
            signal
          )
        );
        if (
          result.receipt.goalId.toLowerCase() !== goalId ||
          result.requestedOfferId.toLowerCase() !== query.offerId.toLowerCase()
        )
          throw new Error();
        return result;
      } catch {
        throw new Error('Protected offer unavailable');
      }
    },
  };
}
