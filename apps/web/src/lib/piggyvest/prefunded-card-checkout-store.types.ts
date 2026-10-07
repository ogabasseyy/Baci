import type { z } from 'zod';
import type { prefundedCardCheckoutSchemas } from '@/schemas/prefunded-card-checkout';
import type { prefundedCardCheckoutStateSchemas } from '@/schemas/prefunded-card-checkout-state';

type Scope = z.infer<typeof prefundedCardCheckoutSchemas.scope>;
type Request = z.infer<typeof prefundedCardCheckoutSchemas.request>;
type Selection = z.infer<typeof prefundedCardCheckoutSchemas.selection>;
type Claim = z.infer<typeof prefundedCardCheckoutStateSchemas.claim>;
type Session = z.infer<typeof prefundedCardCheckoutSchemas.session>;
type Collection = z.infer<typeof prefundedCardCheckoutSchemas.collection>;

export interface PrefundedCardCheckoutStore {
  reserve(scope: Scope, request: Request): Promise<unknown>;
  read(scope: Scope, selection: Selection): Promise<unknown>;
  claimInitialization(scope: Scope, selection: Selection): Promise<unknown>;
  completeInitialization(
    scope: Scope,
    selection: Selection,
    claim: Claim,
    session: Session
  ): Promise<unknown>;
  markInitializationUncertain(
    scope: Scope,
    selection: Selection,
    claim: Claim
  ): Promise<void>;
  promoteVerifiedCollection(
    scope: Scope,
    selection: Selection,
    collection: Collection
  ): Promise<unknown>;
  flagReconciliation(scope: Scope, selection: Selection): Promise<void>;
}
