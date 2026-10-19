import 'server-only';
import { prefundedCardBackgroundRunnerSchemas } from '@/schemas/prefunded-card-background-runner';
import { prefundedCardCheckoutRecoveryRunnerStateSchemas as recoverySchemas } from '@/schemas/prefunded-card-checkout-recovery-runner-state';

const SYSTEM_IDENTIFIER = '7685292944002592802';
const MAX_DISPATCH_RUNTIME_MS = 240_000;
const MAX_OVERALL_RUNTIME_MS = 480_000;

export function createPrefundedCardBackgroundRunner({
  scope,
  expectedDatabaseName,
  recovery,
  composition,
  now = Date.now,
}: {
  scope: unknown;
  expectedDatabaseName: unknown;
  recovery: { run(): Promise<unknown> };
  composition: { tick(): Promise<unknown> };
  now?: () => number;
}) {
  const parsed = recoverySchemas.scope.safeParse(scope);
  if (
    !parsed.success ||
    typeof expectedDatabaseName !== 'string' ||
    parsed.data.databaseName !== expectedDatabaseName ||
    parsed.data.deployment !== 'staging' ||
    parsed.data.systemIdentifier !== SYSTEM_IDENTIFIER
  )
    throw new Error('Prefunded background runner unavailable');

  let started = false;
  const deadline = Date.parse(parsed.data.expiresAt);
  return {
    async run() {
      if (started) return { status: 'busy' as const };
      started = true;
      const startedAt = now();
      if (!Number.isFinite(startedAt) || startedAt >= deadline)
        return { status: 'expired' as const };

      let recoveryResult: unknown;
      try {
        recoveryResult = await recovery.run();
      } catch {
        return { status: 'failed' as const };
      }

      if (
        typeof recoveryResult !== 'object' ||
        recoveryResult === null ||
        !('status' in recoveryResult)
      )
        return { status: 'failed' as const };
      const recoveryStatus = recoveryResult.status;
      if (recoveryStatus === 'busy') return { status: 'busy' as const };
      if (recoveryStatus === 'expired') return { status: 'expired' as const };
      if (recoveryStatus !== 'completed') return { status: 'failed' as const };

      const checkpoint = now();
      const elapsed = checkpoint - startedAt;
      if (
        !Number.isFinite(checkpoint) ||
        checkpoint >= deadline ||
        checkpoint < startedAt ||
        MAX_OVERALL_RUNTIME_MS - elapsed < MAX_DISPATCH_RUNTIME_MS
      )
        return { status: 'expired' as const };

      try {
        const dispatch = await composition.tick();
        const finishedAt = now();
        if (
          !Number.isFinite(finishedAt) ||
          finishedAt >= deadline ||
          finishedAt < checkpoint ||
          finishedAt - startedAt >= MAX_OVERALL_RUNTIME_MS
        )
          return { status: 'expired' as const };

        const parsedDispatch =
          prefundedCardBackgroundRunnerSchemas.dispatchResult.safeParse(
            dispatch
          );
        if (!parsedDispatch.success) return { status: 'failed' as const };
        if (
          parsedDispatch.data.failed > 0 ||
          parsedDispatch.data.unacknowledged > 0
        )
          return { status: 'failed' as const };
        return { status: 'completed' as const };
      } catch {
        return { status: 'failed' as const };
      }
    },
  };
}
