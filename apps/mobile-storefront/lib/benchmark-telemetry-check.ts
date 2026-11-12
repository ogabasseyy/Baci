import * as Sentry from '@sentry/react-native';
import { asyncStorage } from '@/lib/storage';

const ATTEMPT_STORAGE_KEY = 'benchmark-startup-telemetry-attempt';
/** The stored value marks an attempt only; server receipt must be verified separately. */
export function createBenchmarkTelemetryVerifier(options: {
  diagnosticId?: string;
  environment?: string;
}) {
  const diagnosticId = options.diagnosticId?.trim();
  const environment = options.environment?.trim();
  let attemptedId: string | null = null;
  let inFlight: Promise<void> | null = null;
  return function verifyBenchmarkTelemetry(): Promise<void> {
    if (
      environment !== 'benchmark' ||
      !diagnosticId ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(diagnosticId) ||
      attemptedId === diagnosticId
    )
      return Promise.resolve();
    if (inFlight) return inFlight;

    inFlight = (async () => {
      let marked = false;
      try {
        // Ensure inFlight is assigned before even an early unavailable-SDK return.
        await Promise.resolve();
        const client = Sentry.getClient();
        if (!client || client.getOptions().enabled === false) return;
        if (
          (await asyncStorage.getItem(ATTEMPT_STORAGE_KEY)) === diagnosticId
        ) {
          attemptedId = diagnosticId;
          return;
        }
        // Persist an attempt before capture to avoid repeated sends on cold launches.
        // A failed synchronous capture clears it for a subsequent retry.
        await asyncStorage.setItem(ATTEMPT_STORAGE_KEY, diagnosticId);
        marked = true;
        const eventId = Sentry.withScope((scope) => {
          scope.setUser(null);
          scope.clearBreadcrumbs();
          scope.addEventProcessor((event) => ({
            ...event,
            environment: 'benchmark',
            user: undefined,
            breadcrumbs: [],
            contexts: undefined,
            extra: undefined,
            request: undefined,
            tags: {
              diagnostic_id: diagnosticId,
              verification_kind: 'startup_receipt',
            },
          }));
          return Sentry.captureMessage('Startup telemetry verification', {
            level: 'info',
            tags: {
              diagnostic_id: diagnosticId,
              verification_kind: 'startup_receipt',
            },
          });
        });
        if (!eventId || !/^[a-f0-9]{32}$/i.test(eventId))
          throw new Error('Capture unavailable');
        attemptedId = diagnosticId;
        // Flush is an attempt to drain the SDK queue, not proof of server receipt.
        await Sentry.flush();
      } catch {
        if (marked && attemptedId !== diagnosticId) {
          await asyncStorage
            .removeItem(ATTEMPT_STORAGE_KEY)
            .catch(() => undefined);
        }
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
}
