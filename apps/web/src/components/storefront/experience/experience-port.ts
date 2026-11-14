import type {
  BridgeRequest,
  BridgeResult,
  CartBridgeResult,
  PortBinding,
  RouteState,
} from '@baci/shared/experience';
import { parseBridgeRequest } from '@/schemas/experience-bridge';

const error = (
  code: 'INVALID_REQUEST' | 'STALE_ROUTE' | 'LAUNCH_EXPIRED'
): BridgeResult<unknown> => ({
  status: 'error',
  code: code === 'LAUNCH_EXPIRED' ? 'LAUNCH_EXPIRED' : code,
  message: 'Experience request unavailable.',
});
/** Strict host dispatcher. Only injected mock handlers are installed in private previews. */
export function createExperiencePort(
  binding: PortBinding,
  current: () => RouteState,
  dispatch: (
    request: BridgeRequest
  ) => Promise<BridgeResult<unknown> | CartBridgeResult>
) {
  let destroyed = false;
  const ledger = new Map<
    string,
    {
      payload: string;
      settled: boolean;
      result: Promise<BridgeResult<unknown> | CartBridgeResult>;
    }
  >();
  return {
    async receive(
      input: unknown
    ): Promise<BridgeResult<unknown> | CartBridgeResult> {
      if (destroyed) return error('LAUNCH_EXPIRED');
      let request: BridgeRequest;
      try {
        request = parseBridgeRequest(input);
      } catch {
        return error('INVALID_REQUEST');
      }
      if (
        request.instanceId !== binding.instanceId ||
        request.buildDigest !== binding.buildDigest
      )
        return error('INVALID_REQUEST');
      const payload = JSON.stringify(request);
      const prior = ledger.get(request.requestId);
      if (prior)
        return prior.payload === payload
          ? prior.result
          : error('INVALID_REQUEST');
      if (request.routeEpoch !== current().epoch) return error('STALE_ROUTE');
      if (ledger.size >= 256) {
        // Bound replay retention without evicting in-flight effects. Durable
        // cart retries still use the same commerce-engine operation ID.
        const oldest = [...ledger].find(([, entry]) => entry.settled);
        if (!oldest) return error('INVALID_REQUEST');
        ledger.delete(oldest[0]);
      }
      const result = Promise.resolve()
        .then(() => {
          if (destroyed) return error('LAUNCH_EXPIRED');
          if (request.routeEpoch !== current().epoch)
            return error('STALE_ROUTE');
          return dispatch(request);
        })
        .catch(() => error('INVALID_REQUEST'))
        .finally(() => {
          entry.settled = true;
        });
      const entry = { payload, result, settled: false };
      ledger.set(request.requestId, entry);
      return await result;
    },
    destroy() {
      destroyed = true;
      ledger.clear();
    },
  };
}
