import { readPrefundedCardActivationConfig } from '../../../apps/web/src/lib/piggyvest/prefunded-card-activation-config-file';

async function main() {
  const filePath = process.argv[2];
  if (!filePath || process.argv.length !== 3) {
    process.stderr.write(
      'Usage: pnpm exec tsx tools/staging/prefunded-card/activation-config-preflight.ts <owner-only-config.json>\n'
    );
    process.exitCode = 2;
    return;
  }

  const result = await readPrefundedCardActivationConfig(filePath);
  if (!result.ok) {
    for (const issue of result.issues) {
      process.stdout.write(`${issue.status}: ${issue.prerequisite}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    'Declared activation configuration is internally consistent.\n'
  );
  process.stdout.write(
    'Independent proof is still required for TLS reachability, owner enrollment, deployed routes, and provider settlement.\n'
  );
}

void main().catch(() => {
  process.stderr.write(
    'missing_or_invalid: activation config preflight failed\n'
  );
  process.exitCode = 1;
});
