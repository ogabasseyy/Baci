import { piggyvestPurchaseSchemas as schemas } from '../contracts/piggyvest-purchase';
import { piggyvestSavingsScreenSchema } from '../contracts/piggyvest-savings-screen';
import type { createPiggyvestPurchaseClient } from './piggyvest-purchase-client';
import type {
  PurchaseCommand,
  PurchasePublished,
  PurchaseReceipt,
  PurchaseRecovery,
  PurchaseView,
} from './piggyvest-purchase-controller.types';

export function createPiggyvestPurchaseController(options: {
  source: unknown;
  tenantKey: string;
  operationId: unknown;
  mode?: 'prepare' | 'recovery';
  client: Pick<
    ReturnType<typeof createPiggyvestPurchaseClient>,
    'quote' | 'prepare' | 'status'
  > &
    Partial<
      Pick<ReturnType<typeof createPiggyvestPurchaseClient>, 'setViewGuard'>
    >;
  isCurrent: (
    identity: Readonly<{
      sessionKey: string;
      tenantKey: string;
      goalId: string;
    }>
  ) => boolean;
  now?: () => number;
}) {
  const source = piggyvestSavingsScreenSchema.parse(options.source);
  if (
    source.status !== 'ready' ||
    !options.tenantKey?.trim() ||
    options.tenantKey.length > 1024 ||
    typeof options.isCurrent !== 'function' ||
    !['prepare', 'recovery'].includes(options.mode ?? 'prepare')
  )
    throw new Error('Purchase unavailable');
  const identity = Object.freeze({
    sessionKey: source.sessionKey,
    goalId: source.goalId.toLowerCase(),
    tenantKey: options.tenantKey,
  });
  const operationId = schemas.statusRequest.shape.operationId.parse(
    options.operationId
  );
  const contextKey = JSON.stringify(source.policy);
  const now = options.now ?? Date.now;
  const abort = new AbortController();
  let active = true;
  let viewGuard = () => true;
  options.client.setViewGuard?.(() => current() && viewGuard() === true);
  let state: PurchaseView['status'] =
    options.mode === 'recovery' ? 'uncertain' : 'selection';
  let quote: PurchasePublished | null = null;
  let command: PurchaseCommand | null = null;
  let receipt: PurchaseReceipt | null = null;
  let recovery: PurchaseRecovery | null = null;
  let recovering = false;
  let version = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    version++;
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        listeners.delete(listener);
      }
    }
  };
  function current() {
    try {
      if (!active || options.isCurrent(identity) !== true) active = false;
    } catch {
      active = false;
    }
    if (!active) abort.abort();
    return active;
  }
  function matches(input: unknown) {
    const parsed = piggyvestSavingsScreenSchema.safeParse(input);
    return (
      parsed.success &&
      parsed.data.status === 'ready' &&
      parsed.data.sessionKey === identity.sessionKey &&
      parsed.data.goalId.toLowerCase() === identity.goalId &&
      JSON.stringify(parsed.data.policy) === contextKey
    );
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
    getSnapshot: () => version,
    getFundingBlocked: () =>
      !active || ['pending', 'uncertain', 'prepared'].includes(state),
    invalidate() {
      active = false;
      abort.abort();
      notify();
    },
    read(input: unknown): PurchaseView | null {
      if (!current() || !matches(input)) {
        active = false;
        abort.abort();
        return null;
      }
      const base = {
        sessionKey: identity.sessionKey,
        goalId: identity.goalId,
        operationId,
      };
      if (state === 'review' && quote && command) {
        if (Date.parse(quote.quote.expiresAt) <= now())
          return { ...base, status: 'unavailable' };
        return {
          ...base,
          status: 'review',
          quote: schemas.published.parse(quote),
          command: schemas.confirmation.parse(command),
        };
      }
      if (state === 'pending' || state === 'prepared' || state === 'uncertain')
        return {
          ...base,
          status: state,
          recovering,
          receipt: receipt ? schemas.receipt.parse(receipt) : null,
          recovery: recovery ? schemas.status.parse(recovery) : null,
        };
      return { ...base, status: state === 'review' ? 'unavailable' : state };
    },
    async quote(input: unknown): Promise<void> {
      if (
        !current() ||
        !viewGuard() ||
        !['selection', 'review', 'unavailable'].includes(state) ||
        source.policy.consent !== 'accepted'
      )
        throw new Error('Purchase unavailable');
      state = 'loading_quote';
      quote = null;
      command = null;
      notify();
      try {
        const selection = schemas.selection.parse(input);
        if (selection.goalId !== identity.goalId) throw new Error();
        const result = schemas.published.parse(
          await options.client.quote(selection, abort.signal)
        );
        if (
          !current() ||
          result.goalId !== identity.goalId ||
          result.quote.quoteId !== selection.quoteId ||
          result.shippingRateId !== selection.shippingRateId ||
          result.quote.savingsKobo !== selection.savingsKobo ||
          result.quote.revisionId !== source.policy.revisionId.toLowerCase() ||
          result.quote.termsHash !== source.policy.terms.hash ||
          result.quote.termsVersion !== source.policy.terms.version ||
          result.quote.condition !== source.policy.device.condition ||
          Date.parse(result.quote.expiresAt) <= now()
        )
          throw new Error();
        quote = result;
        command = schemas.confirmation.parse({
          goalId: identity.goalId,
          operationId,
          accepted: true,
          fulfilmentMode: 'pickup',
          quote: result.quote,
        });
        state = 'review';
      } catch {
        state = 'unavailable';
        throw new Error('Purchase unavailable');
      } finally {
        notify();
      }
    },
    async prepare(input: unknown): Promise<PurchaseReceipt> {
      if (
        !current() ||
        !viewGuard() ||
        state !== 'review' ||
        !command ||
        !quote ||
        Date.parse(quote.quote.expiresAt) <= now() ||
        JSON.stringify(schemas.confirmation.parse(input)) !==
          JSON.stringify(command)
      )
        throw new Error('Purchase unavailable');
      state = 'pending';
      recovery = null;
      notify();
      try {
        const result = schemas.receipt.parse(
          await options.client.prepare(
            schemas.confirmation.parse(command),
            abort.signal
          )
        );
        if (
          !current() ||
          result.goalId !== identity.goalId ||
          result.operationId !== operationId ||
          result.quoteId !== command.quote.quoteId ||
          result.savingsKobo !== command.quote.savingsKobo ||
          result.principalKobo !== command.quote.principalKobo ||
          result.paidInterestKobo !== command.quote.paidInterestKobo ||
          result.otherPaymentKobo !== command.quote.otherPaymentKobo ||
          result.surplusKobo !== command.quote.surplusKobo
        )
          throw new Error();
        receipt = result;
        state = 'prepared';
        return schemas.receipt.parse(result);
      } catch {
        state = 'uncertain';
        throw new Error('Purchase unavailable');
      } finally {
        notify();
      }
    },
    async recover(): Promise<void> {
      if (
        !current() ||
        recovering ||
        !['prepared', 'uncertain'].includes(state)
      )
        throw new Error('Purchase unavailable');
      recovering = true;
      recovery = null;
      notify();
      try {
        const result = schemas.status.parse(
          await options.client.status(
            { goalId: identity.goalId, operationId },
            abort.signal
          )
        );
        if (
          !current() ||
          result.goalId !== identity.goalId ||
          result.operationId !== operationId ||
          (command !== null &&
            (result.quoteId !== command.quote.quoteId ||
              result.savingsKobo !== command.quote.savingsKobo ||
              result.principalKobo !== command.quote.principalKobo ||
              result.paidInterestKobo !== command.quote.paidInterestKobo ||
              result.otherPaymentKobo !== command.quote.otherPaymentKobo ||
              result.surplusKobo !== command.quote.surplusKobo))
        )
          throw new Error();
        recovery = result;
      } catch {
        recovery = null;
        throw new Error('Purchase unavailable');
      } finally {
        recovering = false;
        notify();
      }
    },
  };
}
