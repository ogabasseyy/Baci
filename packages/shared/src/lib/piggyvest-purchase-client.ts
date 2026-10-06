import { piggyvestPurchaseSchemas as schemas } from '../contracts/piggyvest-purchase';
import { piggyvestPolicyClientSchemas } from '../schemas/piggyvest-policy-client';
import { createPiggyvestCustomerClientRequest } from './piggyvest-customer-client-request';

export function createPiggyvestPurchaseClient(
  options: Parameters<typeof createPiggyvestCustomerClientRequest>[0] & {
    goalId: unknown;
  }
) {
  const config = piggyvestPolicyClientSchemas.configuration.parse(
    options.configuration
  );
  const goalId = schemas.statusRequest.shape.goalId.parse(options.goalId);
  const paths = {
    quote: `${config.endpointPath}/quote`,
    prepare: `${config.endpointPath}/prepare`,
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
    async quote(input: unknown, signal?: AbortSignal) {
      try {
        const body = schemas.selection.parse(input);
        if (body.goalId !== goalId) throw new Error();
        const result = schemas.published.parse(
          await request(
            { method: 'POST', endpointPath: paths.quote, body },
            signal
          )
        );
        if (
          result.goalId !== goalId ||
          result.shippingRateId !== body.shippingRateId ||
          result.quote.quoteId !== body.quoteId ||
          result.quote.savingsKobo !== body.savingsKobo
        )
          throw new Error();
        return result;
      } catch {
        throw new Error('Purchase unavailable');
      }
    },
    async prepare(input: unknown, signal?: AbortSignal) {
      try {
        const body = schemas.confirmation.parse(input);
        if (body.goalId !== goalId) throw new Error();
        const result = schemas.receipt.parse(
          await request(
            { method: 'POST', endpointPath: paths.prepare, body },
            signal
          )
        );
        if (
          result.goalId !== goalId ||
          result.operationId !== body.operationId ||
          result.quoteId !== body.quote.quoteId ||
          result.savingsKobo !== body.quote.savingsKobo ||
          result.principalKobo !== body.quote.principalKobo ||
          result.paidInterestKobo !== body.quote.paidInterestKobo ||
          result.otherPaymentKobo !== body.quote.otherPaymentKobo ||
          result.surplusKobo !== body.quote.surplusKobo
        )
          throw new Error();
        return result;
      } catch {
        throw new Error('Purchase unavailable');
      }
    },
    async status(input: unknown, signal?: AbortSignal) {
      try {
        const selection = schemas.statusRequest.parse(input);
        if (selection.goalId !== goalId) throw new Error();
        const result = schemas.status.parse(
          await request(
            { method: 'GET', endpointPath: paths.status, query: selection },
            signal
          )
        );
        if (
          result.goalId !== goalId ||
          result.operationId !== selection.operationId
        )
          throw new Error();
        return result;
      } catch {
        throw new Error('Purchase unavailable');
      }
    },
  };
}
