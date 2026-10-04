import 'server-only';
import { prefundedCardCheckoutSchemas as checkoutSchemas } from '@/schemas/prefunded-card-checkout';
import { prefundedCardCheckoutRecoverySchemas as recoverySchemas } from '@/schemas/prefunded-card-checkout-recovery';
import { prefundedCardCheckoutStateSchemas as stateSchemas } from '@/schemas/prefunded-card-checkout-state';
import type { PrefundedCardCheckoutStore } from './prefunded-card-checkout-store.types';

type Scope = ReturnType<typeof checkoutSchemas.scope.parse>;
type Intent = ReturnType<typeof checkoutSchemas.intent.parse>;
type Selection = ReturnType<typeof checkoutSchemas.selection.parse>;
type Cursor = ReturnType<typeof recoverySchemas.cursor.parse>;
type Page = ReturnType<typeof recoverySchemas.page.parse>;

type RecoveryStore = Pick<
  PrefundedCardCheckoutStore,
  'promoteVerifiedCollection' | 'flagReconciliation'
>;

function selectionFor(intent: Intent): Selection {
  return checkoutSchemas.selection.parse({
    intentId: intent.intentId,
    customerId: intent.customerId,
    actorId: intent.actorId,
    goalId: intent.goalId,
  });
}

function cursorKey(cursor: Cursor): string {
  return `${cursor.createdAt}\u0000${cursor.intentId}`;
}

export function createPrefundedCardCheckoutRecovery({
  scope,
  listCandidates,
  provider,
  store,
}: {
  scope: unknown;
  listCandidates: (input: {
    scope: Scope;
    after: Cursor | null;
    limit: number;
  }) => Promise<unknown>;
  provider: { verify(intent: Intent): Promise<unknown> };
  store: RecoveryStore;
}) {
  const configured = checkoutSchemas.scope.safeParse(scope);
  if (!configured.success) throw new Error('First-card recovery unavailable');
  const pins = Object.freeze(configured.data);
  const matchesScope = (intent: Intent) =>
    Object.keys(pins).every(
      (key) =>
        intent[key as keyof typeof pins] === pins[key as keyof typeof pins]
    );
  const emptyResult = (after: Cursor | null) => ({
    candidates: 0,
    failed: 1,
    nextCursor: after,
    wrapped: false,
    pending: 0,
    reconciliations: 0,
    promoted: 0,
  });

  return {
    async run(input: unknown) {
      const request = recoverySchemas.request.parse(input);
      const after = request.after ?? null;
      let page: Page;
      try {
        page = recoverySchemas.page.parse(
          await listCandidates({
            scope: pins,
            after,
            limit: request.limit,
          })
        );
      } catch {
        return emptyResult(after);
      }

      let failed = 0;
      let pending = 0;
      let reconciliations = 0;
      let promoted = 0;

      for (const candidate of page.candidates) {
        try {
          const intent = candidate.intent;
          if (!matchesScope(intent))
            throw new Error('First-card recovery unavailable');
          const selection = selectionFor(intent);
          const verification = stateSchemas.verification.parse(
            await provider.verify(intent)
          );

          if (verification.outcome === 'pending') {
            pending += 1;
            continue;
          }
          if (verification.outcome === 'reconciliation_required') {
            await store.flagReconciliation(pins, selection);
            reconciliations += 1;
            continue;
          }
          const collection = verification.collection;
          if (
            collection.intentId !== intent.intentId ||
            collection.reference !== intent.reference ||
            collection.amountKobo !== intent.amountKobo ||
            collection.currency !== intent.currency ||
            collection.authorization.email !== intent.email
          ) {
            throw new Error('First-card recovery unavailable');
          }
          const snapshot = stateSchemas.snapshot.parse(
            await store.promoteVerifiedCollection(pins, selection, collection)
          );
          if (JSON.stringify(snapshot.intent) !== JSON.stringify(intent))
            throw new Error('First-card recovery unavailable');
          if (snapshot.phase === 'reconciliation_required') {
            reconciliations += 1;
          } else if (
            ['funding_pending', 'completed'].includes(snapshot.phase)
          ) {
            promoted += 1;
          } else {
            throw new Error('First-card recovery unavailable');
          }
        } catch {
          failed += 1;
        }
      }

      return {
        candidates: page.candidates.length,
        failed,
        nextCursor: page.nextCursor,
        wrapped: Boolean(
          after &&
            page.candidates.length > 0 &&
            page.nextCursor &&
            cursorKey(page.nextCursor) <= cursorKey(after)
        ),
        pending,
        reconciliations,
        promoted,
      };
    },
  };
}
