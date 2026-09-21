/**
 * App-local entry point for the shared eligible-offers predicate, kept so
 * feed consumers share one import path. The implementation lives in
 * `@baci/shared/lib` alongside the condition normalizers so the VPS
 * backfill can use the identical rule.
 */
export {
  type ConditionOfferLike,
  getEligibleConditionOffers,
} from '@baci/shared/lib';
