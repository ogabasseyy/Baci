import { piggyvestDraftClosureSchemas as schemas } from '../contracts/piggyvest-draft-closure';
import { piggyvestSavingsScreenSchema } from '../contracts/piggyvest-savings-screen';

export function createPiggyvestDraftClosureController(options: {
  source: unknown;
  tenantKey: string;
  operationId: unknown;
  recovery?: boolean;
  read: () => Promise<unknown>;
  close: (command: ReturnType<typeof schemas.close.parse>) => Promise<unknown>;
  isCurrent: (
    identity: Readonly<{
      sessionKey: string;
      goalId: string;
      tenantKey: string;
    }>
  ) => boolean;
}) {
  const source = piggyvestSavingsScreenSchema.parse(options.source);
  if (
    source.status !== 'ready' ||
    typeof options.tenantKey !== 'string' ||
    !options.tenantKey.trim() ||
    options.tenantKey.length > 1024 ||
    [options.read, options.close, options.isCurrent].some(
      (value) => typeof value !== 'function'
    )
  )
    throw new Error('Plan closure unavailable');
  const policy = source.policy;
  const identity = Object.freeze({
    sessionKey: source.sessionKey,
    goalId: source.goalId.toLowerCase(),
    tenantKey: options.tenantKey,
  });
  const command = schemas.close.parse({
    goalId: source.goalId,
    revisionId: policy.revisionId,
    termsVersion: policy.terms.version,
    termsHash: policy.terms.hash,
    operationId: options.operationId,
    accepted: true,
  });
  const sourceKey = JSON.stringify(source);
  let active = true;
  let guard = () => true;
  let compatible = () => true;
  let busy = false;
  let attempted = options.recovery === true;
  let revision = 0;
  let status:
    | 'loading'
    | 'review'
    | 'uncertain'
    | 'closed'
    | 'unavailable'
    | 'requires_reconciliation' = attempted ? 'uncertain' : 'loading';
  let response: ReturnType<typeof schemas.response.parse> | null = null;
  const listeners = new Set<() => void>();
  const same = (left: string, right: string) =>
    left.toLowerCase() === right.toLowerCase();
  function current() {
    try {
      if (options.isCurrent(identity) !== true || guard() !== true)
        active = false;
    } catch {
      active = false;
    }
    return active;
  }
  function notify() {
    revision++;
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        listeners.delete(listener);
      }
    }
  }
  function parse(value: unknown) {
    const parsed = schemas.response.parse(value);
    if (!same(parsed.goalId, command.goalId)) throw new Error();
    if (
      'revisionId' in parsed &&
      (!same(parsed.revisionId, command.revisionId) ||
        parsed.termsVersion !== command.termsVersion ||
        parsed.termsHash !== command.termsHash)
    )
      throw new Error();
    if (
      parsed.status === 'closed' &&
      attempted &&
      !same(parsed.operationId, command.operationId)
    )
      throw new Error();
    return parsed;
  }
  async function run(task: () => Promise<void>) {
    if (!current() || busy) throw new Error('Plan closure unavailable');
    busy = true;
    notify();
    try {
      await task();
      if (!current()) throw new Error();
    } catch {
      status = attempted ? 'uncertain' : 'unavailable';
      response = null;
      throw new Error('Plan closure unavailable');
    } finally {
      busy = false;
      notify();
    }
  }
  return {
    setCompatibilityGuard(value: () => boolean) {
      compatible = value;
    },
    isDispatchCompatible() {
      try {
        return compatible() === true;
      } catch {
        return false;
      }
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => revision,
    getFundingBlocked: () => !active || busy || status !== 'review',
    getPendingOperationId: () => (attempted ? command.operationId : null),
    setViewGuard(value: () => boolean) {
      guard = value;
    },
    isViewCurrent() {
      try {
        return active && guard() === true;
      } catch {
        return false;
      }
    },
    invalidate() {
      active = false;
      notify();
    },
    read(input: unknown) {
      const parsed = piggyvestSavingsScreenSchema.safeParse(input);
      if (!parsed.success || JSON.stringify(parsed.data) !== sourceKey)
        active = false;
      if (!current()) return null;
      return {
        status,
        busy,
        reviewVersion: revision,
        terms: { ...policy.terms },
        response: response ? schemas.response.parse(response) : null,
      };
    },
    async refresh() {
      await run(async () => {
        const parsed = parse(await options.read());
        if (!current()) throw new Error();
        response = parsed;
        status =
          parsed.status === 'available'
            ? attempted
              ? 'uncertain'
              : 'review'
            : parsed.status;
      });
    },
    async close(accepted: unknown, displayedVersion: unknown) {
      if (compatible() !== true) throw new Error('Plan closure unavailable');
      if (
        accepted !== true ||
        displayedVersion !== revision ||
        status !== 'review' ||
        attempted
      )
        throw new Error('Plan closure unavailable');
      await run(async () => {
        if (!current()) throw new Error();
        attempted = true;
        status = 'uncertain';
        const parsed = parse(await options.close(schemas.close.parse(command)));
        if (!current() || parsed.status !== 'closed') throw new Error();
        response = parsed;
        status = 'closed';
      });
    },
  };
}
