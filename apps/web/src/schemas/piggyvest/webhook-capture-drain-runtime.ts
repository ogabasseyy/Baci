import { z } from 'zod';
import { piggyvestPrimaryWalletRuntimeSchema } from '../piggyvest-primary-wallet-runtime';
import { piggyvestCaptureStatusSchema } from './webhook-capture';

/**
 * Configuration and wire shapes of the PiggyVest webhook capture drain,
 * which runs on the worker host under its own database login
 * (supabase/migrations/20261102202552_piggyvest_webhook_capture_worker_role.sql).
 * The login is fixed here, never read from the environment, so a
 * misconfigured host cannot point the drain at a broader identity.
 */
export const PIGGYVEST_CAPTURE_DRAIN_LOGIN =
  'baci_piggyvest_webhook_capture_drain' as const;
export const PIGGYVEST_CAPTURE_WORKER_ROLE =
  'piggyvest_webhook_capture_worker' as const;

export const piggyvestCaptureDrainRuntimeSchema = z.strictObject({
  database: piggyvestPrimaryWalletRuntimeSchema.shape.database.extend({
    login: z.literal(PIGGYVEST_CAPTURE_DRAIN_LOGIN),
  }),
});

export type PiggyvestCaptureDrainRuntime = z.infer<
  typeof piggyvestCaptureDrainRuntimeSchema
>;

/** One row of the session verification query (see the pg executor). */
export const piggyvestCaptureDrainSessionRowSchema = z.object({
  database_name: z.string(),
  login_name: z.string(),
  role_name: z.string(),
  login_safe: z.boolean(),
  membership_count: z.int().nonnegative(),
  worker_membership: z.boolean(),
  grants_usable: z.boolean(),
  capture_surface_denied: z.boolean(),
  unexpected_privileges: z.int().nonnegative(),
  tls: z.boolean(),
});

export const piggyvestCaptureResolveRowSchema = z.object({
  resolved: z.boolean(),
});

export const piggyvestCaptureStatusRowSchema = z.object({
  status: piggyvestCaptureStatusSchema.extend({
    claimRecoveryVersion: z.literal(1),
  }),
});
