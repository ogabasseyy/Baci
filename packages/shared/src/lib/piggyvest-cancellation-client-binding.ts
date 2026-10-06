import { piggyvestCancellationReviewSchemas } from '../contracts/piggyvest-cancellation-review';
import { piggyvestSavingsScreenSchema } from '../contracts/piggyvest-savings-screen';
import { createPiggyvestCancellationClient } from './piggyvest-cancellation-client';
import { createPiggyvestCancellationController } from './piggyvest-cancellation-controller';

export async function createPiggyvestCancellationClientBinding(options: {
  mode: 'prepare' | 'recovery';
  source: unknown;
  tenantKey: string;
  operationId?: unknown;
  http: Omit<
    Parameters<typeof createPiggyvestCancellationClient>[0],
    'goalId' | 'isCurrent'
  >;
  isCurrent: Parameters<
    typeof createPiggyvestCancellationController
  >[0]['isCurrent'];
}) {
  try {
    const source = piggyvestSavingsScreenSchema.parse(options.source);
    if (
      source.status !== 'ready' ||
      !['prepare', 'recovery'].includes(options.mode) ||
      typeof options.tenantKey !== 'string' ||
      !options.tenantKey.trim() ||
      options.tenantKey.length > 1024 ||
      typeof options.isCurrent !== 'function'
    )
      throw new Error();
    let active = true;
    if (options.mode === 'prepare' || options.operationId !== undefined)
      piggyvestCancellationReviewSchemas.confirmation.shape.operationId.parse(
        options.operationId
      );
    const abort = new AbortController();
    const identity = Object.freeze({
      sessionKey: source.sessionKey,
      tenantKey: options.tenantKey,
      goalId: source.goalId.toLowerCase(),
    });
    const isCurrent = options.isCurrent;
    const current = () => {
      try {
        if (!active || isCurrent(identity) !== true) active = false;
      } catch {
        active = false;
      }
      if (!active) abort.abort();
      return active;
    };
    if (!current()) throw new Error();
    const client = createPiggyvestCancellationClient({
      ...options.http,
      goalId: source.goalId,
      isCurrent: current,
    });
    const quote =
      options.mode === 'prepare' ? await client.quote(abort.signal) : undefined;
    if (!current()) throw new Error();
    const controller = createPiggyvestCancellationController({
      source,
      tenantKey: options.tenantKey,
      operationId: options.operationId,
      quote,
      isCurrent: current,
      prepare: (command) => client.prepare(command, abort.signal),
      setTransportViewGuard: client.setViewGuard,
      recover: (request) => client.recover(request, abort.signal),
    });
    return {
      ...controller,
      invalidate() {
        active = false;
        abort.abort();
        controller.invalidate();
      },
    };
  } catch {
    throw new Error('Cancellation unavailable');
  }
}
