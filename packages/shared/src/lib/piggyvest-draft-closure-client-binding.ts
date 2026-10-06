import { piggyvestSavingsScreenSchema } from '../contracts/piggyvest-savings-screen';
import { createPiggyvestDraftClosureClient } from './piggyvest-draft-closure-client';
import { createPiggyvestDraftClosureController } from './piggyvest-draft-closure-controller';

export async function createPiggyvestDraftClosureClientBinding(
  options: Omit<
    Parameters<typeof createPiggyvestDraftClosureController>[0],
    'read' | 'close'
  > & {
    http: Omit<
      Parameters<typeof createPiggyvestDraftClosureClient>[0],
      'goalId' | 'isCurrent'
    >;
  }
) {
  const source = piggyvestSavingsScreenSchema.parse(options.source);
  if (source.status !== 'ready') throw new Error('Plan closure unavailable');
  const identity = {
    sessionKey: source.sessionKey,
    tenantKey: options.tenantKey,
    goalId: source.goalId.toLowerCase(),
  };
  const abort = new AbortController();
  let active = true;
  let viewCurrent = () => true;
  let compatible = () => true;
  const current = () => {
    try {
      if (options.isCurrent(identity) !== true || !viewCurrent())
        active = false;
    } catch {
      active = false;
    }
    if (!active) abort.abort();
    return active;
  };
  const client = createPiggyvestDraftClosureClient({
    ...options.http,
    goalId: source.goalId,
    isCurrent: () => current() && compatible(),
  });
  const controller = createPiggyvestDraftClosureController({
    ...options,
    isCurrent: current,
    read: () => client.read(abort.signal),
    close: (command) => client.close(command, abort.signal),
  });
  viewCurrent = controller.isViewCurrent;
  compatible = controller.isDispatchCompatible;
  await controller.refresh().catch(() => undefined);
  if (!current()) throw new Error('Plan closure unavailable');
  return {
    ...controller,
    invalidate() {
      active = false;
      abort.abort();
      controller.invalidate();
    },
  };
}
