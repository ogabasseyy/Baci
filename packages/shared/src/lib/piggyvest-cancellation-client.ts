import { piggyvestCancellationRecoverySchemas as recovery } from '../contracts/piggyvest-cancellation-recovery';
import { piggyvestCancellationReviewSchemas as cancellation } from '../contracts/piggyvest-cancellation-review';
import { piggyvestCancellationClientSchema } from '../schemas/piggyvest-cancellation-client';
import { createPiggyvestCustomerClientRequest } from './piggyvest-customer-client-request';

export function createPiggyvestCancellationClient(options: {
  configuration: unknown;
  goalId: unknown;
  fetch: typeof globalThis.fetch;
  getCsrfToken: (signal: AbortSignal) => Promise<string>;
  isCurrent: () => boolean;
}) {
  const parsed = piggyvestCancellationClientSchema.safeParse(
    options.configuration
  );
  const fixedGoal = recovery.request.shape.goalId.safeParse(options.goalId);
  if (
    !parsed.success ||
    !fixedGoal.success ||
    typeof options.fetch !== 'function' ||
    typeof options.getCsrfToken !== 'function' ||
    typeof options.isCurrent !== 'function'
  )
    throw new Error('Cancellation unavailable');
  const config = parsed.data;
  const goalIdentity = fixedGoal.data.toLowerCase();
  let viewGuard = () => true;
  const request = createPiggyvestCustomerClientRequest({
    ...options,
    isCurrent: () => options.isCurrent() === true && viewGuard() === true,
    configuration: {
      mode: config.mode,
      baseUrl: config.baseUrl,
      credentials: config.credentials,
      endpointPaths: [config.endpointPath, config.recoveryEndpointPath],
    },
  });
  return {
    setViewGuard(guard: () => boolean) {
      viewGuard = guard;
    },
    async quote(signal?: AbortSignal) {
      try {
        const view = cancellation.quote.parse(
          await request(
            {
              method: 'GET',
              endpointPath: config.endpointPath,
              query: { goalId: goalIdentity },
            },
            signal
          )
        );
        if (view.goalId.toLowerCase() !== goalIdentity) throw new Error();
        return view;
      } catch {
        throw new Error('Cancellation unavailable');
      }
    },
    async prepare(input: unknown, signal?: AbortSignal) {
      try {
        const body = cancellation.confirmation.parse(input);
        if (body.goalId.toLowerCase() !== goalIdentity) throw new Error();
        const view = cancellation.receipt.parse(
          await request(
            { method: 'POST', endpointPath: config.endpointPath, body },
            signal
          )
        );
        if (
          view.goalId.toLowerCase() !== goalIdentity ||
          view.operationId.toLowerCase() !== body.operationId.toLowerCase()
        )
          throw new Error();
        return view;
      } catch {
        throw new Error('Cancellation unavailable');
      }
    },
    async recover(input: unknown, signal?: AbortSignal) {
      try {
        const selection = recovery.request.parse(input);
        if (selection.goalId.toLowerCase() !== goalIdentity) throw new Error();
        const view = recovery.response.parse(
          await request(
            {
              method: 'GET',
              endpointPath: config.recoveryEndpointPath,
              query: {
                goalId: goalIdentity,
                ...(selection.operationId
                  ? { operationId: selection.operationId.toLowerCase() }
                  : {}),
              },
            },
            signal
          )
        );
        if (
          view.goalId.toLowerCase() !== goalIdentity ||
          (view.requestedOperationId?.toLowerCase() ?? null) !==
            (selection.operationId?.toLowerCase() ?? null)
        )
          throw new Error();
        return view;
      } catch {
        throw new Error('Cancellation unavailable');
      }
    },
  };
}
