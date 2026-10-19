import { piggyvestSavingsScreenSchema } from '../contracts/piggyvest-savings-screen';
import { createPiggyvestScheduleClient } from './piggyvest-schedule-client';
import { createPiggyvestScheduleController } from './piggyvest-schedule-controller';

export async function createPiggyvestScheduleClientBinding(
  options: Omit<
    Parameters<typeof createPiggyvestScheduleController>[0],
    'read' | 'submit'
  > & {
    http: Omit<
      Parameters<typeof createPiggyvestScheduleClient>[0],
      'goalId' | 'isCurrent'
    >;
  }
) {
  try {
    const source = piggyvestSavingsScreenSchema.parse(options.source);
    if (source.status !== 'ready') throw new Error();
    const identity = Object.freeze({
      sessionKey: source.sessionKey,
      tenantKey: options.tenantKey,
      goalId: source.goalId.toLowerCase(),
    });
    const abort = new AbortController();
    let active = true;
    let viewCurrent = () => true;
    let compatible = () => true;
    const isCurrent = options.isCurrent;
    const current = () => {
      try {
        if (isCurrent(identity) !== true || !viewCurrent()) active = false;
      } catch {
        active = false;
      }
      if (!active) abort.abort();
      return active;
    };
    const client = createPiggyvestScheduleClient({
      ...options.http,
      goalId: source.goalId,
      isCurrent: () => current() && compatible(),
    });
    const controller = createPiggyvestScheduleController({
      ...options,
      isCurrent: current,
      read: (operationId) => client.read(operationId, abort.signal),
      submit: (request) => client.submit(request, abort.signal),
    });
    viewCurrent = controller.isViewCurrent;
    compatible = controller.isDispatchCompatible;
    await controller.refresh().catch(() => undefined);
    if (!current()) throw new Error();
    return {
      ...controller,
      invalidate() {
        active = false;
        abort.abort();
        controller.invalidate();
      },
    };
  } catch {
    throw new Error('Schedule unavailable');
  }
}
