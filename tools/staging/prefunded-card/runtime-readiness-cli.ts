import { readPrefundedCardActivationConfig } from '../../../apps/web/src/lib/piggyvest/prefunded-card-activation-config-file';
import { PrefundedCardPostgresFailure } from '../../../apps/web/src/lib/piggyvest/prefunded-card-postgres-failure';
import { verifyPrefundedCardRuntimeReadiness } from '../../../apps/web/src/lib/piggyvest/prefunded-card-runtime-readiness';

async function main() {
  const [mode, path] = process.argv.slice(2);
  if (
    process.argv.length !== 4 ||
    !path ||
    (mode !== '--check' && mode !== '--connect')
  )
    throw new Error();
  const result = await readPrefundedCardActivationConfig(path);
  if (!result.ok) throw new Error();
  const report =
    mode === '--connect'
      ? await verifyPrefundedCardRuntimeReadiness(result.source)
      : {
          status: 'configuration-checked',
          databaseContacted: false,
          cardPaymentsEnabled: false,
        };
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

void main().catch((error: unknown) => {
  const diagnostic =
    error instanceof Error &&
    error.cause instanceof PrefundedCardPostgresFailure
      ? error.cause.diagnostic
      : undefined;
  process.stdout.write(
    `${JSON.stringify({ status: 'refused', redacted: true, cardPaymentsEnabled: false, ...(diagnostic ? { diagnostic } : {}) })}\n`
  );
  process.exitCode = 1;
});
