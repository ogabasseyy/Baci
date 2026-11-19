import 'server-only';
import {
  type PiggyvestWebhookIntakeRuntime,
  piggyvestWebhookIntakeRuntimeSchema,
} from '@/schemas/piggyvest-webhook-intake-runtime';

/**
 * Reads the receiver's restricted-login settings straight from the process
 * environment. Throws when any is missing or malformed: the receiver then
 * fails closed (503 + alert) exactly as it does for an unconfigured signing
 * key, and there is no fallback to a broader database credential.
 */
export function readPiggyvestWebhookIntakeRuntime(
  env: NodeJS.ProcessEnv = process.env
): PiggyvestWebhookIntakeRuntime {
  const parsed = piggyvestWebhookIntakeRuntimeSchema.safeParse({
    database: {
      host: env.PIGGYVEST_PRIMARY_DB_HOST,
      port: Number(env.PIGGYVEST_PRIMARY_DB_PORT),
      name: env.PIGGYVEST_PRIMARY_DB_NAME,
      login: 'baci_piggyvest_webhook_intake',
      password: env.PIGGYVEST_WEBHOOK_INTAKE_DB_PASSWORD,
      certificateAuthority: env.PIGGYVEST_PRIMARY_DB_CA,
    },
  });
  if (!parsed.success)
    throw new Error('PiggyVest webhook intake database unavailable');
  return parsed.data;
}

/** Configuration-only check; session/TLS verification still runs on connect. */
export function isPiggyvestWebhookIntakeRuntimeReady(
  env: NodeJS.ProcessEnv
): boolean {
  try {
    readPiggyvestWebhookIntakeRuntime(env);
    return true;
  } catch {
    return false;
  }
}
