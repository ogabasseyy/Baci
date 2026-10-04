import 'server-only';
import { randomUUID } from 'node:crypto';
import { prefundedCardCheckoutRecoveryRunnerStateSchemas as runnerSchemas } from '@/schemas/prefunded-card-checkout-recovery-runner-state';

const MAX_PAGES = 4;
const PAGE_SIZE = 4;
const MAX_RUNTIME_MS = 240_000;

type Scope = ReturnType<typeof runnerSchemas.scope.parse>;
type Cursor = ReturnType<typeof runnerSchemas.cursor.parse> | null;

function sameScope(left: Scope, right: Scope): boolean {
  return Object.keys(left).every(
    (key) => left[key as keyof Scope] === right[key as keyof Scope]
  );
}

function cursorKey(cursor: NonNullable<Cursor>): string {
  return `${cursor.createdAt}\u0000${cursor.intentId}`;
}

function cursorWrapped(previous: Cursor, next: Cursor): boolean {
  return Boolean(previous && next && cursorKey(next) <= cursorKey(previous));
}

export function createPrefundedCardCheckoutRecoveryRunner({
  scope,
  recovery,
  stateStore,
  now = Date.now,
  createToken = randomUUID,
}: {
  scope: unknown;
  recovery: { run(input: unknown): Promise<unknown> };
  stateStore: {
    acquire(input: { scope: Scope; token: string }): Promise<unknown>;
    commit(input: {
      scope: Scope;
      token: string;
      cursor: Cursor;
    }): Promise<boolean>;
  };
  now?: () => number;
  createToken?: () => string;
}) {
  const configured = runnerSchemas.scope.safeParse(scope);
  if (!configured.success)
    throw new Error('First-card recovery runner unavailable');
  const pins = Object.freeze(configured.data);
  const deadline = Date.parse(pins.expiresAt);

  return {
    async run() {
      const startedAt = now();
      if (!Number.isFinite(startedAt) || startedAt >= deadline)
        return { status: 'expired' as const };
      const withinBounds = () => {
        const checkpoint = now();
        return (
          Number.isFinite(checkpoint) &&
          checkpoint < deadline &&
          checkpoint - startedAt < MAX_RUNTIME_MS
        );
      };

      const token = createToken();
      if (!runnerSchemas.token.safeParse(token).success)
        return { status: 'failed' as const };

      let lease: ReturnType<typeof runnerSchemas.lease.parse>;
      try {
        lease = runnerSchemas.lease.parse(
          await stateStore.acquire({
            scope: pins,
            token,
          })
        );
      } catch {
        return { status: 'failed' as const };
      }
      if (lease.outcome === 'busy') return { status: 'busy' as const };
      if (!sameScope(lease.scope, pins) || lease.token !== token) {
        return { status: 'failed' as const };
      }
      if (!withinBounds()) return { status: 'expired' as const };

      let cursor: Cursor = lease.cursor;
      let pages = 0;
      const totals = {
        candidates: 0,
        failed: 0,
        pending: 0,
        reconciliations: 0,
        promoted: 0,
      };
      try {
        for (; pages < MAX_PAGES; pages += 1) {
          if (!withinBounds()) return { status: 'expired' as const };
          const previous = cursor;
          const result = runnerSchemas.recoveryResult.parse(
            await recovery.run({ after: previous, limit: PAGE_SIZE })
          );
          for (const key of Object.keys(totals) as (keyof typeof totals)[])
            totals[key] += result[key];

          cursor = result.nextCursor;
          if (result.wrapped && !cursorWrapped(previous, cursor))
            return { status: 'failed' as const };
          if (!result.wrapped && cursorWrapped(previous, cursor))
            return { status: 'failed' as const };
          if (result.wrapped || result.candidates === 0) {
            cursor = null;
            pages += 1;
            break;
          }
          if (cursor === null) {
            pages += 1;
            break;
          }
        }
        if (!withinBounds()) return { status: 'expired' as const };
        const committed = await stateStore.commit({
          scope: pins,
          token,
          cursor,
        });
        if (committed !== true) return { status: 'failed' as const };
        return { status: 'completed' as const, pages, ...totals };
      } catch {
        return { status: 'failed' as const };
      }
    },
  };
}
