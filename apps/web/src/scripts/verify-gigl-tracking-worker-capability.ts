import 'dotenv/config';

import { pathToFileURL } from 'node:url';
import { createGiglTrackingWorkerClient } from '@/lib/gigl-tracking-worker-client';
import {
  GiglWrapperSchemaMissingError,
  verifyGiglTrackingWorkerCapability,
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

/** Runs the credentialed, non-mutating GIGL capability smoke. */
export async function runGiglTrackingCapabilityVerification({
  env = process.env,
  logger = console,
}: {
  env?: NodeJS.ProcessEnv;
  logger?: CapabilityLogger;
} = {}): Promise<number> {
  if (isExplicitlyDisabled(env.GIGL_ENABLED)) {
    logger.info('[gigl-capability] skipped while GIGL is disabled');
    try {
      // A disabled skip still latches the cutover gate, so an unhealthy
      // token would silently break polling on re-enable. Warn (never
      // fail): a disabled setup may legitimately have no token yet.
      createGiglTrackingWorkerClient(env);
    } catch {
      logger.info(
        '[gigl-capability] worker token missing or expired; provision it before re-enabling GIGL'
      );
    }
    return 0;
  }

  try {
    const client = createGiglTrackingWorkerClient(env);
    if (await verifyGiglTrackingWorkerCapability(client)) {
      if (await verifyGiglTrackingWorkerScopeProbe(client)) {
        logger.info('[gigl-capability] restricted wrapper verified');
        return 0;
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
