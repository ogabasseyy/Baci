import { piggyvestCancellationRecoverySchemas as recovery } from '../contracts/piggyvest-cancellation-recovery';
import { piggyvestCancellationReviewSchemas as cancellation } from '../contracts/piggyvest-cancellation-review';
import { piggyvestSavingsScreenSchema } from '../contracts/piggyvest-savings-screen';

type Command = ReturnType<typeof cancellation.confirmation.parse>;
type Receipt = ReturnType<typeof cancellation.receipt.parse>;
type Quote = Extract<
  ReturnType<typeof cancellation.quote.parse>,
  { status: 'quote_available' }
>;
type Recovery = ReturnType<typeof recovery.response.parse>;
type View =
  | {
      status: 'review';
      sessionKey: string;
      goalId: string;
      operationId: string;
      quote: Quote;
      command: Command;
    }
  | {
      status: 'pending' | 'uncertain' | 'prepared';
      recovery: Recovery | null;
      recovering: boolean;
    };

export function createPiggyvestCancellationController(options: {
  source: unknown;
  tenantKey: string;
  operationId?: unknown;
  quote?: unknown;
  prepare?: (command: Command) => Promise<unknown>;
  setTransportViewGuard?: (guard: () => boolean) => void;
  recover?: (
    request: ReturnType<typeof recovery.request.parse>
  ) => Promise<unknown>;
  isCurrent: (
    identity: Readonly<{
      sessionKey: string;
      tenantKey: string;
      goalId: string;
    }>
  ) => boolean;
}) {
  const source = piggyvestSavingsScreenSchema.parse(options.source);
  const quote =
    options.quote === undefined
      ? null
      : cancellation.quote.parse(options.quote);
  if (
    source.status !== 'ready' ||
    typeof options.tenantKey !== 'string' ||
    !options.tenantKey.trim() ||
    options.tenantKey.length > 1024 ||
    typeof options.isCurrent !== 'function' ||
    (quote &&
      (quote.status !== 'quote_available' ||
        typeof options.prepare !== 'function' ||
        quote.goalId.toLowerCase() !== source.goalId.toLowerCase() ||
        quote.revisionId.toLowerCase() !==
          source.policy.revisionId.toLowerCase() ||
        quote.termsHash !== source.policy.terms.hash ||
        quote.termsVersion !== source.policy.terms.version))
  )
    throw new Error('Cancellation unavailable');
  const identity = Object.freeze({
    sessionKey: source.sessionKey,
    tenantKey: options.tenantKey,
    goalId: source.goalId.toLowerCase(),
  });
  const command =
    quote?.status === 'quote_available'
      ? cancellation.confirmation.parse({
          goalId: quote.goalId,
          operationId: options.operationId,
          revisionId: quote.revisionId,
          termsVersion: quote.termsVersion,
          termsHash: quote.termsHash,
          consentVersion: quote.consentVersion,
          principalKobo: quote.principalKobo,
          paidInterestKobo: quote.paidInterestKobo,
          pendingInterestKobo: quote.pendingInterestKobo,
          accepted: true,
        })
      : null;
  const recoveryRequest = recovery.request.parse({
    goalId: source.goalId,
    ...(options.operationId === undefined
      ? {}
      : { operationId: options.operationId }),
  });
  const serialized = JSON.stringify(command);
  const policyKey = (policy: typeof source.policy) =>
    JSON.stringify({
      ...policy,
      goalId: policy.goalId.toLowerCase(),
      revisionId: policy.revisionId.toLowerCase(),
    });
  const originalPolicy = policyKey(source.policy);
  let active = true;
  let viewGuard = () => true;
  options.setTransportViewGuard?.(() => current() && viewGuard() === true);
  let status: 'review' | 'pending' | 'uncertain' | 'prepared' = command
    ? 'review'
    : 'uncertain';
  let recoveryResult: Recovery | null = null;
  let recovering = false;
  let receipt: Receipt | null = null;
  const listeners = new Set<() => void>();
  function notify() {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        listeners.delete(listener);
      }
    }
  }
  const prepare = options.prepare;
  const isCurrent = options.isCurrent;
  const recover = options.recover;
  function current() {
    try {
      if (!active || isCurrent(identity) !== true) active = false;
    } catch {
      active = false;
    }
    return active;
  }
  return {
    setViewGuard(guard: () => boolean) {
      viewGuard = guard;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getFundingBlocked() {
      return !active || status !== 'review';
    },
    invalidate() {
      active = false;
      notify();
    },
    read(input: unknown): View | null {
      if (!current()) return null;
      const parsed = piggyvestSavingsScreenSchema.safeParse(input);
      if (!parsed.success || parsed.data.status !== 'ready') return null;
      if (
        parsed.data.sessionKey !== identity.sessionKey ||
        parsed.data.goalId.toLowerCase() !== identity.goalId
      ) {
        active = false;
        return null;
      }
      if (policyKey(parsed.data.policy) !== originalPolicy) return null;
      return status === 'review' &&
        command &&
        quote?.status === 'quote_available'
        ? {
            status,
            sessionKey: identity.sessionKey,
            goalId: quote.goalId,
            operationId: command.operationId,
            quote: { ...quote },
            command: { ...command },
          }
        : {
            status: status === 'review' ? 'uncertain' : status,
            recovery: recoveryResult
              ? recovery.response.parse(recoveryResult)
              : null,
            recovering,
          };
    },
    async recover(): Promise<void> {
      if (
        !current() ||
        recovering ||
        status === 'pending' ||
        typeof recover !== 'function'
      )
        throw new Error('Cancellation unavailable');
      recovering = true;
      if (status === 'review') status = 'uncertain';
      notify();
      try {
        const response = recovery.response.parse(
          await recover({ ...recoveryRequest })
        );
        if (
          !current() ||
          response.goalId.toLowerCase() !== identity.goalId ||
          (response.requestedOperationId?.toLowerCase() ?? null) !==
            (recoveryRequest.operationId?.toLowerCase() ?? null)
        )
          throw new Error();
        recoveryResult = response;
      } catch {
        recoveryResult = null;
        throw new Error('Cancellation unavailable');
      } finally {
        recovering = false;
        notify();
      }
    },
    async prepare(input: unknown): Promise<Receipt> {
      try {
        if (
          !current() ||
          !viewGuard() ||
          !command ||
          !prepare ||
          JSON.stringify(cancellation.confirmation.parse(input)) !== serialized
        )
          throw new Error();
        if (status === 'prepared' && receipt) return { ...receipt };
        if (status !== 'review') throw new Error();
        status = 'pending';
        notify();
        const parsed = cancellation.receipt.parse(
          await prepare({ ...command })
        );
        if (
          !current() ||
          parsed.goalId.toLowerCase() !== identity.goalId ||
          parsed.operationId.toLowerCase() !==
            command.operationId.toLowerCase() ||
          parsed.status !== 'prepared'
        )
          throw new Error();
        receipt = parsed;
        status = 'prepared';
        notify();
        return { ...parsed };
      } catch {
        if (status === 'pending') status = 'uncertain';
        notify();
        throw new Error('Cancellation unavailable');
      }
    },
  };
}
