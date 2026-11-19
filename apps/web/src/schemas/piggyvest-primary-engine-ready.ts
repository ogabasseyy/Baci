import { z } from 'zod';

/**
 * Surfaces the ledger and transfer engine reports readiness for, through
 * piggyvest_primary.engine_ready(surface). Declared up front so the callers
 * added later (settlement worker, spend paths, goal moves) do not each have
 * to edit this list; the database decides what each surface needs.
 */
export const piggyvestPrimaryEngineSurfaceSchema = z.enum([
  'inflow',
  'bank_inbox',
  'settlement_drain',
  'settlement_full',
  'spend',
  'spend_vtu',
  'spend_imei',
  'spend_checkout',
  'goal_inflow',
  'goal_exit',
  'legacy_migration',
  'support_payout',
  'treasury_sweep',
  'approvals',
]);
export type PiggyvestPrimaryEngineSurface = z.infer<
  typeof piggyvestPrimaryEngineSurfaceSchema
>;

// Marker ids only (counts and catalog facts, never customer data).
const missingMarker = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);

/**
 * The verdict is binary and self-consistent: ready means nothing is missing,
 * not ready names at least one missing marker. Anything else is malformed
 * and callers treat it as not ready.
 */
export const piggyvestPrimaryEngineReadySchema = z.union([
  z.strictObject({
    ready: z.literal(true),
    missing: z.array(missingMarker).length(0),
  }),
  z.strictObject({
    ready: z.literal(false),
    missing: z.array(missingMarker).min(1).max(64),
  }),
]);
export type PiggyvestPrimaryEngineReadiness = z.infer<
  typeof piggyvestPrimaryEngineReadySchema
>;
