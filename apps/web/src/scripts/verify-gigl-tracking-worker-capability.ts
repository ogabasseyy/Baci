import 'dotenv/config';

import { pathToFileURL } from 'node:url';
import {
  GiglWorkerTokenError,
  createGiglTrackingWorkerClient,
  createGiglTrackingWorkerScopeProbeClient,
} from '@/lib/gigl-tracking-worker-client';
import { GiglApiClient } from '@/lib/shipping/providers/gigl.auth';
import type { GiglFetchOptions } from '@/lib/shipping/providers/gigl.constants';
import {
  GiglWrapperSchemaMissingError,
  verifyGiglTrackingWorkerCapability,
  verifyGiglTrackingWorkerScopePathProbe,
  verifyGiglTrackingWorkerScopeProbe,
} from '@/lib/verify-gigl-tracking-worker-capability';

/**
 * Exit code when the wrapper RPCs predate the migration (initial rollout),
 * including the pre-isolation state where the role and RPCs exist but the
 * authenticator grant is still pending. `prepare-worker-release.sh` defers
 * to the post-migration workflow smoke on this code; every other caller
 * must treat it as a failure.
 */
export const GIGL_CAPABILITY_SCHEMA_MISSING_EXIT_CODE = 42;

interface CapabilityLogger {
  error(message: string): void;
  info(message: string): void;
}

function isExplicitlyDisabled(value: string | undefined) {
  return ['0', 'false', 'off'].includes(value?.trim().toLowerCase() ?? '');
}

const GIGL_PROVIDER_AUTH_PROBE_TIMEOUT_MS = 15_000;

/**
 * Bounded, non-mutating provider login against the installed
 * GIGL_EMAIL/GIGL_PASSWORD/GIGL_BASE_URL. The wrapper checks below
 * prove the database capability but never touch the provider, so
 * without this probe stale-but-nonempty credentials would latch and
 * let vercel.json drop the working Vercel schedule. Redacted by
 * construction: true/false only, never status or response text.
 */
async function verifyGiglProviderAuthDefault(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    GIGL_PROVIDER_AUTH_PROBE_TIMEOUT_MS
  );
  try {
    const client = new GiglApiClient({
      safeFetch: (url: string, options?: GiglFetchOptions) =>
        fetch(url, {
          ...options,
          signal: options?.signal ?? controller.signal,
        }),
      log: () => undefined,
    });
    await client.getApiToken(
      GIGL_PROVIDER_AUTH_PROBE_TIMEOUT_MS,
      controller.signal
    );
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Runs the credentialed, non-mutating GIGL capability smoke. */
export async function runGiglTrackingCapabilityVerification({
  env = process.env,
  logger = console,
  verifyProviderAuth = verifyGiglProviderAuthDefault,
}: {
  env?: NodeJS.ProcessEnv;
  logger?: CapabilityLogger;
  verifyProviderAuth?: () => Promise<boolean>;
} = {}): Promise<number> {
  if (isExplicitlyDisabled(env.GIGL_ENABLED)) {
    logger.info('[gigl-capability] skipped while GIGL is disabled');
    let client: ReturnType<typeof createGiglTrackingWorkerClient>;
    try {
      client = createGiglTrackingWorkerClient(env);
    } catch (error) {
      // Only an independently verified absent/expired/mis-issued token
      // is vacuous. Any other construction failure (malformed URL,
      // plaintext scheme, missing anon key) fails closed: a valid JWT
      // may still be usable against the correct endpoint, unprobed.
      if (!(error instanceof GiglWorkerTokenError)) {
        logger.error(
          '[gigl-capability] worker client misconfigured while GIGL is disabled; fix the Supabase URL/anon key and re-run'
        );
        return 1;
      }
      // A disabled setup may legitimately have no token yet, and with no
      // usable token there is nothing to abuse: latch vacuously.
      logger.info(
        '[gigl-capability] worker token missing or expired; provision it before re-enabling GIGL'
      );
      return 0;
    }
    // A usable token exists while polling is off. Already-issued JWTs
    // still authenticate while the grant is live, so a scope hook that
    // has not reloaded would leave this token reaching beyond the five
    // reviewed RPCs. Prove the hook is ACTIVE before latching — a
    // disabled latch must not certify that broader authority.
    try {
      if (await verifyGiglTrackingWorkerScopeProbe(client)) {
        // Unmapped client: the restricted client above would remap
        // this probe's inner RPC name to its approved wrapper.
        const scopeProbeClient =
          createGiglTrackingWorkerScopeProbeClient(env);
        if (await verifyGiglTrackingWorkerScopePathProbe(scopeProbeClient)) {
          logger.info('[gigl-capability] scope hook verified active');
          return 0;
        }
        logger.error(
          '[gigl-capability] PostgREST scope hook is not enforcing the RPC path allowlist; check the hook definition and re-run'
        );
        return 1;
      }
    } catch (error) {
      if (error instanceof GiglWrapperSchemaMissingError) {
        logger.info(
          '[gigl-capability] wrapper RPCs not deployed yet or role grant pending; deferring to the post-migration smoke'
        );
        return GIGL_CAPABILITY_SCHEMA_MISSING_EXIT_CODE;
      }
      // Keep credential and provider errors out of release logs.
    }
    logger.error(
      '[gigl-capability] PostgREST scope hook is not active; reload PostgREST config and re-run'
    );
    return 1;
  }

  try {
    const client = createGiglTrackingWorkerClient(env);
    if (await verifyGiglTrackingWorkerCapability(client)) {
      if (await verifyGiglTrackingWorkerScopeProbe(client)) {
        // A method-only hook passes the GET probe above while letting
        // POST reach any PUBLIC RPC: prove path enforcement before
        // the latch below can authorize dropping the Vercel schedule.
        // Unmapped client: the restricted client would remap this
        // probe's inner RPC name to its approved wrapper.
        const scopeProbeClient =
          createGiglTrackingWorkerScopeProbeClient(env);
        if (
          await verifyGiglTrackingWorkerScopePathProbe(scopeProbeClient)
        ) {
          // Last: the wrapper checks prove the database capability but
          // never authenticate to the provider. Probe the login before
          // latching.
          if (await verifyProviderAuth()) {
            logger.info('[gigl-capability] restricted wrapper verified');
            return 0;
          }
          logger.error(
            '[gigl-capability] GIGL provider login failed; verify GIGL_EMAIL, GIGL_PASSWORD, and GIGL_BASE_URL, then re-run'
          );
          return 1;
        }
        logger.error(
          '[gigl-capability] PostgREST scope hook is not enforcing the RPC path allowlist; check the hook definition and re-run'
        );
        return 1;
      }
      logger.error(
        '[gigl-capability] PostgREST scope hook is not active; reload PostgREST config and re-run'
      );
      return 1;
    }
  } catch (error) {
    if (error instanceof GiglWrapperSchemaMissingError) {
      logger.info(
        '[gigl-capability] wrapper RPCs not deployed yet or role grant pending; deferring to the post-migration smoke'
      );
      return GIGL_CAPABILITY_SCHEMA_MISSING_EXIT_CODE;
    }
    // Keep credential and provider errors out of release logs.
  }

  logger.error('[gigl-capability] verification failed');
  return 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  runGiglTrackingCapabilityVerification().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
