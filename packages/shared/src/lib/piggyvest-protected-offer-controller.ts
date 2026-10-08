import { piggyvestProtectedOfferSchemas as schemas } from '../contracts/piggyvest-protected-offer';
import { piggyvestSavingsScreenSchema } from '../contracts/piggyvest-savings-screen';
import type { createPiggyvestProtectedOfferClient } from './piggyvest-protected-offer-client';

type Receipt = ReturnType<typeof schemas.receipt.parse>;
type Observation = ReturnType<typeof schemas.observation.parse>;
export function createPiggyvestProtectedOfferController(options: {
  source: unknown;
  tenantKey: string;
  offerId: unknown;
  mode?: 'publish' | 'history';
  client: Pick<
    ReturnType<typeof createPiggyvestProtectedOfferClient>,
    'publish' | 'status'
  > &
    Partial<
      Pick<
        ReturnType<typeof createPiggyvestProtectedOfferClient>,
        'setViewGuard'
      >
    >;
  isCurrent: (
    identity: Readonly<{
      goalId: string;
      sessionKey: string;
      tenantKey: string;
    }>
  ) => boolean;
}) {
  const source = piggyvestSavingsScreenSchema.parse(options.source);
  if (
    source.status !== 'ready' ||
    !options.tenantKey?.trim() ||
    options.tenantKey.length > 1024 ||
    typeof options.isCurrent !== 'function' ||
    !['publish', 'history'].includes(options.mode ?? 'publish')
  )
    throw new Error('Protected offer unavailable');
  const identity = Object.freeze({
    goalId: source.goalId.toLowerCase(),
    sessionKey: source.sessionKey,
    tenantKey: options.tenantKey,
  });
  const policy = source.policy;
  const policyKey = JSON.stringify(policy);
  let offerId = schemas.request.shape.offerId.parse(options.offerId);
  let attempted = options.mode === 'history';
  let active = true;
  let busy = false;
  let status: 'idle' | 'unavailable' | 'observed' = 'idle';
  let receipt: Receipt | null = null;
  let observation: Observation | null = null;
  let viewGuard = () => true;
  let version = 0;
  const abort = new AbortController();
  const listeners = new Set<() => void>();
  function current() {
    try {
      if (!active || options.isCurrent(identity) !== true) active = false;
    } catch {
      active = false;
    }
    if (!active) abort.abort();
    return active;
  }
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
  function scoped(value: Receipt) {
    if (
      value.goalId.toLowerCase() !== identity.goalId ||
      value.revisionId.toLowerCase() !== policy.revisionId.toLowerCase() ||
      value.termsHash !== policy.terms.hash ||
      value.termsVersion !== policy.terms.version ||
      value.device.condition !== policy.device.condition
    )
      throw new Error();
    return value;
  }
  options.client.setViewGuard?.(() => current() && viewGuard() === true);
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
    invalidate() {
      active = false;
      abort.abort();
      notify();
    },
    read(input: unknown) {
      const parsed = piggyvestSavingsScreenSchema.safeParse(input);
      if (
        !current() ||
        !parsed.success ||
        parsed.data.status !== 'ready' ||
        parsed.data.sessionKey !== identity.sessionKey ||
        parsed.data.goalId.toLowerCase() !== identity.goalId ||
        JSON.stringify(parsed.data.policy) !== policyKey
      ) {
        active = false;
        abort.abort();
        return null;
      }
      return {
        status,
        busy,
        offerId,
        receipt: receipt ? schemas.receipt.parse(receipt) : null,
        observation: observation
          ? schemas.observation.parse(observation)
          : null,
      };
    },
    async load() {
      if (!current() || !viewGuard() || busy)
        throw new Error('Protected offer unavailable');
      busy = true;
      observation = null;
      notify();
      try {
        if (!attempted) {
          attempted = true;
          const publication = schemas.published.parse(
            await options.client.publish(
              { goalId: identity.goalId, offerId },
              abort.signal
            )
          );
          if (!current()) throw new Error();
          receipt = scoped(publication.receipt);
          offerId = receipt.offerId;
        }
        const result = schemas.observation.parse(
          await options.client.status(
            { goalId: identity.goalId, offerId },
            abort.signal
          )
        );
        scoped(result.receipt);
        if (
          !current() ||
          result.requestedOfferId.toLowerCase() !== offerId.toLowerCase() ||
          (receipt &&
            JSON.stringify(receipt) !== JSON.stringify(result.receipt))
        )
          throw new Error();
        receipt = result.receipt;
        offerId = receipt.offerId;
        observation = result;
        status = 'observed';
      } catch {
        status = 'unavailable';
        observation = null;
        throw new Error('Protected offer unavailable');
      } finally {
        busy = false;
        notify();
      }
    },
  };
}
