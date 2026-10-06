import { piggyvestDeviceChangeSchemas as schemas } from '../contracts/piggyvest-device-change';
import { piggyvestPolicyClientSchemas } from '../schemas/piggyvest-policy-client';
import { createPiggyvestCustomerClientRequest } from './piggyvest-customer-client-request';

export function createPiggyvestDeviceChangeClient(
  options: Parameters<typeof createPiggyvestCustomerClientRequest>[0] & {
    goalId: unknown;
  }
) {
  const config = piggyvestPolicyClientSchemas.configuration.parse(
    options.configuration
  );
  const goalId = schemas.lookup.shape.goalId.parse(options.goalId);
  const paths = {
    quote: `${config.endpointPath}/quote`,
    confirm: `${config.endpointPath}/confirm`,
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
          result.quote.goalId !== goalId ||
          result.quote.quoteId !== body.quoteId ||
          result.quote.device.productId !== body.productId ||
          result.quote.device.variantId !== body.variantId
        )
          throw new Error();
        return result;
      } catch {
        throw new Error('Device change unavailable');
      }
    },
    async confirm(input: unknown, signal?: AbortSignal) {
      try {
        const body = schemas.confirmation.parse(input);
        if (body.goalId !== goalId || body.quote.goalId !== goalId)
          throw new Error();
        const result = schemas.receipt.parse(
          await request(
            { method: 'POST', endpointPath: paths.confirm, body },
            signal
          )
        );
        const { expiresAt: _expiry, ...expected } = body.quote;
        if (
          JSON.stringify(result) !==
          JSON.stringify(
            schemas.receipt.parse({
              ...expected,
              operationId: body.operationId,
              status: 'device_changed',
              wallet: 'unchanged',
              balances: 'unchanged',
              collection: 'paused',
              dispatch: 'disabled',
            })
          )
        )
          throw new Error();
        return result;
      } catch {
        throw new Error('Device change unavailable');
      }
    },
    async status(input: unknown, signal?: AbortSignal) {
      try {
        const query = schemas.lookup.parse(input);
        if (query.goalId !== goalId) throw new Error();
        const result = schemas.historical.parse(
          await request(
            { method: 'GET', endpointPath: paths.status, query },
            signal
          )
        );
        if (
          result.receipt.goalId !== goalId ||
          result.receipt.operationId !== query.operationId
        )
          throw new Error();
        return result;
      } catch {
        throw new Error('Device change unavailable');
      }
    },
  };
}
