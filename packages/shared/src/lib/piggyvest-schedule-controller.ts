import { piggyvestSavingsScreenSchema } from '../contracts/piggyvest-savings-screen';
import { piggyvestScheduleReviewSchemas as schemas } from '../contracts/piggyvest-schedule-review';

type Snapshot = ReturnType<typeof schemas.snapshot.parse>;
type Request = ReturnType<typeof schemas.request.parse>;
export function createPiggyvestScheduleController(options: {
  source: unknown;
  tenantKey: string;
  recoveryOperationId?: unknown;
  nextOperationId: () => string;
  read: (operationId?: string) => Promise<unknown>;
  submit: (request: Request) => Promise<unknown>;
  isCurrent: (
    identity: Readonly<{
      sessionKey: string;
      tenantKey: string;
      goalId: string;
    }>
  ) => boolean;
}) {
  const source = piggyvestSavingsScreenSchema.parse(options.source);
  if (
    source.status !== 'ready' ||
    typeof options.tenantKey !== 'string' ||
    !options.tenantKey.trim() ||
    options.tenantKey.length > 1024 ||
    [
      options.read,
      options.submit,
      options.isCurrent,
      options.nextOperationId,
    ].some((value) => typeof value !== 'function')
  )
    throw new Error('Schedule unavailable');
  const identity = Object.freeze({
    sessionKey: source.sessionKey,
    tenantKey: options.tenantKey,
    goalId: source.goalId.toLowerCase(),
  });
  const sourceKey = JSON.stringify(source);
  const policy = source.policy;
  const { read, submit, isCurrent, nextOperationId } = options;
  let active = true;
  let viewGuard = () => true;
  let compatible = () => true;
  let busy = false;
  let status: 'loading' | 'ready' | 'uncertain' | 'unavailable' = 'loading';
  let snapshot: Snapshot | null = null;
  let historical: Snapshot['historical'] = null;
  let pending: Request | null = null;
  let recoveryId =
    options.recoveryOperationId === undefined
      ? null
      : schemas.receipt.shape.operationId.parse(options.recoveryOperationId);
  const used = new Set<string>(recoveryId ? [recoveryId] : []);
  const listeners = new Set<() => void>();
  let revision = 0;
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
  function current() {
    try {
      if (isCurrent(identity) !== true || viewGuard() !== true) active = false;
    } catch {
      active = false;
    }
    return active;
  }
  function assertCurrent() {
    if (!current()) throw new Error('Schedule unavailable');
  }
  function parseSnapshot(value: unknown, operationId?: string) {
    const parsed = schemas.snapshot.parse(value);
    if (
      parsed.goalId !== identity.goalId ||
      parsed.revisionId !== policy.revisionId.toLowerCase() ||
      parsed.termsHash !== policy.terms.hash ||
      (parsed.historical &&
        (parsed.historical.receipt.operationId !== operationId ||
          parsed.historical.command.goalId !== identity.goalId))
    )
      throw new Error('Schedule unavailable');
    return parsed;
  }
  async function load(operationId?: string) {
    assertCurrent();
    const response = await read(operationId);
    assertCurrent();
    return parseSnapshot(response, operationId);
  }
  async function write(action: 'observe' | 'pause' | 'request_resume') {
    assertCurrent();
    if (compatible() !== true) throw new Error('Schedule unavailable');
    if (!snapshot || pending || recoveryId)
      throw new Error('Schedule unavailable');
    const operationId = schemas.receipt.shape.operationId.parse(
      nextOperationId()
    );
    if (used.has(operationId)) throw new Error('Schedule unavailable');
    const command = {
      action,
      goalId: identity.goalId,
      expectedVersion: snapshot.state.version,
      ...(action === 'request_resume'
        ? {
            accepted: true,
            operationId,
            revisionId: snapshot.revisionId,
            termsHash: snapshot.termsHash,
          }
        : {}),
    };
    const request = schemas.request.parse({ operationId, command });
    used.add(operationId);
    pending = request;
    recoveryId = operationId;
    const result = schemas.result.parse(
      await submit(schemas.request.parse(request))
    );
    assertCurrent();
    if (
      result.goalId !== identity.goalId ||
      result.status !== 'persisted_proposal' ||
      result.receipt.operationId !== operationId ||
      result.receipt.state.version !== request.command.expectedVersion + 1
    )
      throw new Error('Schedule unavailable');
    const consent = result.receipt.state.consentProposal;
    if (
      action === 'request_resume' &&
      consent &&
      (consent.operationId !== operationId ||
        consent.revisionId !== snapshot.revisionId ||
        consent.termsHash !== snapshot.termsHash)
    )
      throw new Error('Schedule unavailable');
    if (action === 'pause' && consent) throw new Error('Schedule unavailable');
    const latest = await load();
    if (latest.state.version < result.receipt.state.version)
      throw new Error('Schedule unavailable');
    snapshot = latest;
    pending = null;
    recoveryId = null;
  }
  async function run(task: () => Promise<void>) {
    assertCurrent();
    if (busy) throw new Error('Schedule unavailable');
    busy = true;
    notify();
    try {
      await task();
      assertCurrent();
      status = 'ready';
    } catch {
      status = pending || recoveryId ? 'uncertain' : 'unavailable';
      throw new Error('Schedule unavailable');
    } finally {
      busy = false;
      notify();
    }
  }
  return {
    setCompatibilityGuard(guard: () => boolean) {
      compatible = guard;
    },
    isDispatchCompatible() {
      try {
        return compatible() === true;
      } catch {
        return false;
      }
    },
    setViewGuard(guard: () => boolean) {
      viewGuard = guard;
    },
    isViewCurrent() {
      try {
        return active && viewGuard() === true;
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
    getFundingBlocked: () =>
      !active || busy || status !== 'ready' || recoveryId !== null,
    getPendingOperationId: () => recoveryId,
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
        snapshot: snapshot ? schemas.snapshot.parse(snapshot) : null,
        historical: historical
          ? schemas.snapshot.shape.historical.parse(historical)
          : null,
        operationId: recoveryId,
        terms: { ...source.policy.terms },
        canRequestResume:
          status === 'ready' &&
          !busy &&
          source.policy.consent === 'accepted' &&
          snapshot?.state.status === 'paused',
      };
    },
    async refresh() {
      return await run(async () => {
        if (recoveryId) {
          const recovered = await load(recoveryId);
          if (
            !recovered.historical ||
            (pending &&
              JSON.stringify(recovered.historical.command) !==
                JSON.stringify(pending.command))
          )
            throw new Error('Schedule unavailable');
          historical = recovered.historical;
          pending = null;
          recoveryId = null;
          snapshot = recovered;
        } else snapshot = await load();
        await write('observe');
      });
    },
    async pause() {
      if (status !== 'ready' || recoveryId)
        throw new Error('Schedule unavailable');
      return await run(() => write('pause'));
    },
    async requestResume(accepted: unknown, displayedVersion: unknown) {
      if (compatible() !== true) throw new Error('Schedule unavailable');
      if (
        accepted !== true ||
        displayedVersion !== snapshot?.state.version ||
        source.policy.consent !== 'accepted' ||
        status !== 'ready' ||
        recoveryId ||
        snapshot?.state.status !== 'paused'
      )
        throw new Error('Schedule unavailable');
      return await run(() => write('request_resume'));
    },
  };
}
