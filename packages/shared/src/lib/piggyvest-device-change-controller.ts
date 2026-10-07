import { piggyvestDeviceChangeSchemas as schemas } from '../contracts/piggyvest-device-change';
import { piggyvestSavingsScreenSchema } from '../contracts/piggyvest-savings-screen';
import type { createPiggyvestDeviceChangeClient } from './piggyvest-device-change-client';

type Published = ReturnType<typeof schemas.published.parse>;
type Command = ReturnType<typeof schemas.confirmation.parse>;
type Historical = ReturnType<typeof schemas.historical.parse>;
type View = { operationId: string; goalId: string } & (
  | { status: 'selection' | 'loading_quote' | 'unavailable' }
  | { status: 'review'; published: Published; command: Command }
  | {
      status: 'pending' | 'uncertain' | 'confirmed';
      historical: Historical | null;
      recovering: boolean;
    }
);
export function createPiggyvestDeviceChangeController(options: {
  source: unknown;
  tenantKey: string;
  operationId: unknown;
  mode?: 'prepare' | 'recovery';
  client: Pick<
    ReturnType<typeof createPiggyvestDeviceChangeClient>,
    'quote' | 'confirm' | 'status'
  > &
    Partial<
      Pick<ReturnType<typeof createPiggyvestDeviceChangeClient>, 'setViewGuard'>
    >;
  isCurrent: (
    identity: Readonly<{
      goalId: string;
      sessionKey: string;
      tenantKey: string;
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
    throw new Error('Device change unavailable');
  const operationId = schemas.lookup.shape.operationId.parse(
    options.operationId
  );
  const identity = Object.freeze({
    goalId: source.goalId.toLowerCase(),
    sessionKey: source.sessionKey,
    tenantKey: options.tenantKey,
  });
  const sourceKey = JSON.stringify(source.policy);
  const abort = new AbortController();
  const now = options.now ?? Date.now;
  let active = true;
  let viewGuard = () => true;
  let state: View['status'] =
    options.mode === 'recovery' ? 'uncertain' : 'selection';
  let published: Published | null = null;
  let command: Command | null = null;
  let historical: Historical | null = null;
  let recovering = false;
  let version = 0;
  const listeners = new Set<() => void>();
  function notify() {
    version++;
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
      if (!active || options.isCurrent(identity) !== true) active = false;
    } catch {
      active = false;
    }
    if (!active) abort.abort();
    return active;
  }
  options.client.setViewGuard?.(() => current() && viewGuard() === true);
  function expectedReceipt(input: unknown) {
    const result = schemas.receipt.parse(input);
    if (result.goalId !== identity.goalId || result.operationId !== operationId)
      throw new Error();
    if (command) {
      const { expiresAt: _expiry, ...saved } = command.quote;
      const expected = schemas.receipt.parse({
        ...saved,
        operationId,
        status: 'device_changed',
        wallet: 'unchanged',
        balances: 'unchanged',
        collection: 'paused',
        dispatch: 'disabled',
      });
      if (JSON.stringify(expected) !== JSON.stringify(result))
        throw new Error();
    }
    return result;
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
      !active || ['pending', 'uncertain', 'confirmed'].includes(state),
    invalidate() {
      active = false;
      abort.abort();
      notify();
    },
    read(input: unknown): View | null {
      const parsed = piggyvestSavingsScreenSchema.safeParse(input);
      if (
        !current() ||
        !parsed.success ||
        parsed.data.status !== 'ready' ||
        parsed.data.goalId.toLowerCase() !== identity.goalId ||
        parsed.data.sessionKey !== identity.sessionKey ||
        JSON.stringify(parsed.data.policy) !== sourceKey
      ) {
        active = false;
        abort.abort();
        return null;
      }
      const base = { goalId: identity.goalId, operationId };
      if (state === 'review' && command && published)
        return Date.parse(command.quote.expiresAt) > now()
          ? {
              ...base,
              status: 'review',
              command: schemas.confirmation.parse(command),
              published: schemas.published.parse(published),
            }
          : { ...base, status: 'unavailable' };
      if (state === 'pending' || state === 'uncertain' || state === 'confirmed')
        return {
          ...base,
          status: state,
          recovering,
          historical: historical ? schemas.historical.parse(historical) : null,
        };
      return { ...base, status: state === 'review' ? 'unavailable' : state };
    },
    async quote(input: unknown) {
      if (
        !current() ||
        !viewGuard() ||
        !['selection', 'unavailable', 'review'].includes(state)
      )
        throw new Error('Device change unavailable');
      state = 'loading_quote';
      published = null;
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
          result.quote.goalId !== identity.goalId ||
          result.quote.priorRevisionId !==
            source.policy.revisionId.toLowerCase() ||
          result.quote.quoteId !== selection.quoteId ||
          result.quote.device.productId !== selection.productId ||
          result.quote.device.variantId !== selection.variantId ||
          Date.parse(result.quote.expiresAt) <= now()
        )
          throw new Error();
        published = result;
        command = schemas.confirmation.parse({
          goalId: identity.goalId,
          operationId,
          accepted: true,
          quote: result.quote,
        });
        state = 'review';
      } catch {
        state = 'unavailable';
        throw new Error('Device change unavailable');
      } finally {
        notify();
      }
    },
    async confirm(input: unknown) {
      if (
        !current() ||
        !viewGuard() ||
        state !== 'review' ||
        !command ||
        Date.parse(command.quote.expiresAt) <= now() ||
        JSON.stringify(schemas.confirmation.parse(input)) !==
          JSON.stringify(command)
      )
        throw new Error('Device change unavailable');
      state = 'pending';
      historical = null;
      notify();
      try {
        const receipt = expectedReceipt(
          await options.client.confirm(
            schemas.confirmation.parse(command),
            abort.signal
          )
        );
        if (!current()) throw new Error();
        historical = schemas.historical.parse({
          status: 'historical',
          receipt,
        });
        state = 'confirmed';
        return schemas.receipt.parse(receipt);
      } catch {
        state = 'uncertain';
        throw new Error('Device change unavailable');
      } finally {
        notify();
      }
    },
    async recover() {
      if (
        !current() ||
        recovering ||
        !['confirmed', 'uncertain'].includes(state)
      )
        throw new Error('Device change unavailable');
      recovering = true;
      historical = null;
      notify();
      try {
        const result = schemas.historical.parse(
          await options.client.status(
            { goalId: identity.goalId, operationId },
            abort.signal
          )
        );
        expectedReceipt(result.receipt);
        if (!current()) throw new Error();
        historical = result;
      } catch {
        throw new Error('Device change unavailable');
      } finally {
        recovering = false;
        notify();
      }
    },
  };
}
