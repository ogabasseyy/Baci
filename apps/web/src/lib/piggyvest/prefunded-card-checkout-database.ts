import 'server-only';
import { prefundedCardCheckoutSchemas as schemas } from '@/schemas/prefunded-card-checkout';
import { prefundedCardCheckoutStateSchemas as states } from '@/schemas/prefunded-card-checkout-state';
import type { PrefundedCardCheckoutStore } from './prefunded-card-checkout-store.types';
import { PREFUNDED_CARD_POSTGRES_STATEMENTS as statements } from './prefunded-card-postgres-statements';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function createPrefundedCardCheckoutDatabase({
  scope,
  customerExecute,
  verifierExecute,
  now = Date.now,
}: {
  scope: unknown;
  customerExecute: PiggyvestProvisioningExecutor;
  verifierExecute: PiggyvestProvisioningExecutor;
  now?: () => number;
}): PrefundedCardCheckoutStore {
  const configured = schemas.scope.safeParse(scope);
  if (!configured.success) throw new Error('First-card storage unavailable');
  const pins = Object.freeze(configured.data);
  const invoke = async (
    execute: PiggyvestProvisioningExecutor,
    statement: string,
    selectedScope: unknown,
    parameters: readonly unknown[],
    cleanup = false
  ) => {
    const requestedScope = schemas.scope.parse(selectedScope);
    if (JSON.stringify(pins) !== JSON.stringify(requestedScope))
      throw new Error('First-card storage unavailable');
    const timestamp = now();
    if (
      !Number.isFinite(timestamp) ||
      (!cleanup && timestamp >= Date.parse(pins.expiresAt))
    )
      throw new Error('First-card storage unavailable');
    const serialized = parameters.map((parameter) => {
      const value = JSON.stringify(parameter);
      if (typeof value !== 'string')
        throw new Error('First-card storage unavailable');
      return value;
    });
    const response = await execute(statement, [
      JSON.stringify(pins),
      ...serialized,
    ]);
    return states.resultRows.parse(response.rows)[0].result;
  };
  const selectedClaim = (selection: unknown, value: unknown) => {
    const selected = schemas.selection.parse(selection);
    const claim = states.claim.parse(value);
    if (
      claim.intent.intentId !== selected.intentId ||
      claim.intent.customerId !== selected.customerId ||
      claim.intent.actorId !== selected.actorId ||
      claim.intent.goalId !== selected.goalId ||
      Object.keys(pins).some(
        (key) =>
          claim.intent[key as keyof typeof pins] !==
          pins[key as keyof typeof pins]
      )
    )
      throw new Error('First-card storage unavailable');
    return { selected, claim };
  };
  const sanitized = async <Result>(
    operation: () => Promise<Result>
  ): Promise<Result> => {
    try {
      return await operation();
    } catch {
      throw new Error('First-card storage unavailable');
    }
  };

  return {
    reserve: (selectedScope, request) =>
      sanitized(async () =>
        states.snapshot.parse(
          await invoke(
            customerExecute,
            statements.checkoutReserve.text,
            selectedScope,
            [schemas.request.parse(request)]
          )
        )
      ),
    read: (selectedScope, selection) =>
      sanitized(async () =>
        states.snapshot.parse(
          await invoke(
            customerExecute,
            statements.checkoutRead.text,
            selectedScope,
            [schemas.selection.parse(selection)]
          )
        )
      ),
    claimInitialization: (selectedScope, selection) =>
      sanitized(async () =>
        states.initialization.parse(
          await invoke(
            verifierExecute,
            statements.checkoutClaim.text,
            selectedScope,
            [schemas.selection.parse(selection)]
          )
        )
      ),
    completeInitialization: (selectedScope, selection, value, sessionValue) =>
      sanitized(async () => {
        const { selected, claim } = selectedClaim(selection, value);
        const session = schemas.session.parse(sessionValue);
        if (session.reference !== claim.intent.reference)
          throw new Error('First-card storage unavailable');
        return states.snapshot.parse(
          await invoke(
            verifierExecute,
            statements.checkoutComplete.text,
            selectedScope,
            [selected, claim, session]
          )
        );
      }),
    markInitializationUncertain: (selectedScope, selection, value) =>
      sanitized(async () => {
        const { selected, claim } = selectedClaim(selection, value);
        states.acknowledged.parse(
          await invoke(
            verifierExecute,
            statements.checkoutUncertain.text,
            selectedScope,
            [selected, claim],
            true
          )
        );
      }),
    promoteVerifiedCollection: (
      selectedScope,
      selectionValue,
      collectionValue
    ) =>
      sanitized(async () => {
        const selection = schemas.selection.parse(selectionValue);
        const collection = schemas.collection.parse(collectionValue);
        if (
          collection.intentId !== selection.intentId ||
          collection.reference !== `pvb-first-${selection.intentId}`
        )
          throw new Error('First-card storage unavailable');
        return states.snapshot.parse(
          await invoke(
            verifierExecute,
            statements.checkoutPromote.text,
            selectedScope,
            [selection, collection]
          )
        );
      }),
    flagReconciliation: (selectedScope, selection) =>
      sanitized(async () => {
        states.acknowledged.parse(
          await invoke(
            verifierExecute,
            statements.checkoutReconcile.text,
            selectedScope,
            [schemas.selection.parse(selection)]
          )
        );
      }),
  };
}
