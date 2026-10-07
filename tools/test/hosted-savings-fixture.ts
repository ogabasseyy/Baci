import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { hostedSavingsFixtureContract } from './hosted-savings-fixture-contract';
import { buildHostedSavingsFixtureSql } from './hosted-savings-fixture-sql';
import { readHostedSavingsInstallBundle } from './hosted-savings-install-bundle';
import { hostedSavingsInstallDiagnostic } from './hosted-savings-install-diagnostic';
import { createHostedSavingsDocker } from './hosted-savings-install-docker';

export async function seedHostedSavingsFixture(
  input: unknown,
  directory: string,
  apply = false
) {
  const reviewed = hostedSavingsFixtureContract.parse(input);
  const bundle = await readHostedSavingsInstallBundle(
    directory,
    reviewed.destination.manifestSha256
  );
  const sql = buildHostedSavingsFixtureSql(
    reviewed,
    bundle.entries.map((entry) => [entry.ordinal, entry.source, entry.sha256]),
    apply
  );
  const runtime = createHostedSavingsDocker(reviewed.destination);
  await runtime.verify();
  await runtime.sql(sql);
  return {
    status: apply ? 'fixture-committed' : 'fixture-rollback-passed',
    containerId: reviewed.destination.containerId,
    systemIdentifier: reviewed.systemIdentifier,
    manifestSha256: bundle.manifestSha256,
    sqlSha256: createHash('sha256').update(sql).digest('hex'),
    financeEnabled: false,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, inputFile, directory, ...extra] = process.argv.slice(2);
  void (async () => {
    if (
      !['--dry-run', '--seed-reviewed'].includes(mode) ||
      !inputFile ||
      !directory ||
      extra.length
    )
      throw new Error('Invalid fixture arguments');
    const result = await seedHostedSavingsFixture(
      JSON.parse(await readFile(inputFile, 'utf8')),
      directory,
      mode === '--seed-reviewed'
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  })().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ status: 'fixture-failed', ...hostedSavingsInstallDiagnostic(error instanceof Error ? error.message : '') })}\n`
    );
    process.exitCode = 1;
  });
}
