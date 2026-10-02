import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applySupabaseCurrentTreeSources } from './apply-supabase-current-tree-sources';
import { applySupabaseReplaySql } from './apply-supabase-replay-sql';
import { canonicalJsonValue } from './canonical-json-value';
import { createSupabaseReplayProjectId } from './create-supabase-replay-project-id';
import { generateSupabaseReplayTypes } from './generate-supabase-replay-types';
import * as ownershipTools from './replay-project-ownership';
import { replayRepository } from './replay-repository-root';
import { runSupabaseReplayStage } from './run-supabase-replay-stage';
import {
  createSupabaseHistoryReplayRuntimeDependencies,
  type ReplayRuntimeDependencies,
} from './supabase-history-replay-runtime';
import type {
  PendingRepairState,
  ProductionOldCancellationProofMode,
  ReplayReceipt,
  SupabaseHistoryEffectComparisonMode,
  SupabaseHistoryReplayMode,
} from './supabase-history-replay-types';
import {
  assertSupabaseReplayDatabaseUrl,
  createSupabaseReplayDatabaseEnvironment,
  parseSupabaseReplayArguments,
  readSupabaseReplayDatabaseUrl,
} from './supabase-replay-contract';
import type * as resourceTools from './supabase-replay-expected-resources';

type ReplayFailureWithDiagnostics = Error & {
  replayDiagnostics: {
    cleanup: ownershipTools.ReplayProjectCleanupResult;
  };
};
export type SupabaseReplayOptions = {
  comparisonMode: SupabaseHistoryEffectComparisonMode;
  mode: SupabaseHistoryReplayMode;
  pendingRepairState: PendingRepairState;
  productionOldCancellationProof: ProductionOldCancellationProofMode;
  receiptOutput?: string;
  repositoryRoot?: string;
  sqlChecks: string[];
  typesOutput?: string;
};
const hash = (value: string | Buffer) =>
  createHash('sha256').update(value).digest('hex');
const hasResources = (value: resourceTools.ObservedSupabaseReplayResources) =>
  value.containers.length > 0 ||
  value.networks.length > 0 ||
  value.volumes.length > 0;
function withCleanupDiagnostics(
  failure: unknown,
  cleanup: ownershipTools.ReplayProjectCleanupResult | undefined
): unknown {
  if (cleanup?.resourceReadiness !== 'anomalous') return failure;
  const primary =
    failure instanceof Error ? failure : new Error('Supabase replay failed');
  return Object.assign(new Error(primary.message, { cause: primary }), {
    name: primary.name,
    replayDiagnostics: { cleanup },
  }) as ReplayFailureWithDiagnostics;
}
export async function runSupabaseHistoryReplay(
  options: SupabaseReplayOptions,
  dependencies?: ReplayRuntimeDependencies
): Promise<ReplayReceipt> {
  const runtime =
    dependencies ?? createSupabaseHistoryReplayRuntimeDependencies();
  const root =
    options.repositoryRoot ?? replayRepository.root(import.meta.dirname);
  const run = runtime.createCommand(root);
  const verified = await runtime.verifyManifest(root, {
    pendingRepairState: options.pendingRepairState,
  });
  const contract = await runtime.verifyContract({ runCommand: run });
  await run('docker', ['info']);
  const workdir = await runtime.makeWorkdir();
  const projectId = createSupabaseReplayProjectId();
  let cleanup = false;
  let ownership: ownershipTools.ReplayProjectOwnership | undefined;
  let expected: resourceTools.ExpectedSupabaseReplayResources | undefined;
  let receipt: ReplayReceipt | undefined;
  let failure: unknown;
  try {
    if (hasResources(await runtime.inspectResources(projectId, run)))
      throw new Error('Supabase replay project id collision');
    await runSupabaseReplayStage('init', () =>
      run('supabase', ['init', '--workdir', workdir])
    );
    const configPath = path.join(workdir, 'supabase/config.toml');
    const original = await runtime.readText(configPath);
    const originalConfig = runtime.parseConfig(original);
    let ports = await runtime.allocatePorts(originalConfig.ports);
    let rewritten = runtime.rewriteConfig(original, { ports, projectId });
    await runtime.atomicReplace(configPath, rewritten);
    ownership = await runtime.createOwnership({
      originalConfigSha256: hash(original),
      ownedTempRoot: path.dirname(workdir),
      ports,
      preStartEmpty: { containers: true, networks: true, volumes: true },
      projectId,
      rewrittenConfigSha256: hash(rewritten),
      workdir,
    });
    await runtime.writeOwnership(ownership);
    cleanup = true;
    try {
      await runtime.assertPortsAvailable(ports);
    } catch {
      ports = await runtime.allocatePorts(originalConfig.ports);
      rewritten = runtime.rewriteConfig(original, { ports, projectId });
      await runtime.atomicReplace(configPath, rewritten);
      ownership = await runtime.createOwnership({
        ...ownership,
        ownedTempRoot: path.dirname(workdir),
        ports,
        rewrittenConfigSha256: hash(rewritten),
      });
      await runtime.atomicReplace(
        ownershipTools.replayProjectOwnershipPath(workdir),
        canonicalJsonValue(ownership)
      );
      await runtime.assertPortsAvailable(ports);
    }
    await Promise.all(
      verified.bootstrapSources.map((source) =>
        runtime.copyBootstrapSource(root, workdir, source)
      )
    );
    expected = runtime.expectedResources(
      runtime.parseConfig(rewritten),
      projectId
    );
    await runSupabaseReplayStage('db start', () =>
      run('supabase', ['db', 'start', '--workdir', workdir])
    );
    await runSupabaseReplayStage('migration up', () =>
      run('supabase', ['migration', 'up', '--local', '--workdir', workdir])
    );
    const databaseUrl = await runSupabaseReplayStage('status', () =>
      readSupabaseReplayDatabaseUrl(run, workdir)
    );
    assertSupabaseReplayDatabaseUrl(databaseUrl, ports['db.port']);
    await runtime.verifyBootstrapHistory({
      databaseUrl,
      expectedSources: verified.bootstrapSources,
      psqlBin: contract.psqlBin,
      runCommand: run,
    });
    runtime.assertResources(
      await runtime.inspectResources(projectId, run),
      expected,
      {
        allowPartial: false,
        projectId,
      }
    );
    const env = createSupabaseReplayDatabaseEnvironment(databaseUrl);
    const versionArgs = ['-X', '-w', '-At', '-c', 'SHOW server_version_num'];
    const version = async () =>
      (await run(contract.psqlBin, versionArgs, { env })).stdout.trim();
    const orderedSources = runtime.materializeReplay(verified, options.mode);
    if (
      verified.bootstrapSources.length !== 125 ||
      orderedSources
        .slice(0, 125)
        .some(
          (source, index) =>
            source.repositoryPath !==
            verified.bootstrapSources[index]?.repositoryPath
        )
    )
      throw new Error('Replay bootstrap order mismatch');
    // biome-ignore format: keep this orchestration module within its 300-line cap.
    const fileArgs = ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-f'];
    const apply = (sqlPath: string) =>
      run(contract.psqlBin, [...fileArgs, sqlPath], { env });
    for (const [index, source] of orderedSources.slice(125).entries()) {
      const ordinal = index + 126;
      const sqlPath = await runtime.materializeSource(
        root,
        workdir,
        source,
        ordinal
      );
      await applySupabaseReplaySql(apply, {
        kind: 'migration',
        ordinal,
        sqlPath,
      });
    }
    const productionOldCancellationProof =
      options.productionOldCancellationProof === 'required'
        ? await runtime.verifyProductionOldCancellation({
            databaseUrl,
            environment: env,
            psqlBin: contract.psqlBin,
            repositoryRoot: root,
          })
        : undefined;
    const effects = await runtime.verifyEffects({
      comparisonMode: options.comparisonMode,
      databaseUrl,
      psqlBin: contract.psqlBin,
      productionOldCancellationProof,
      readEffects: runtime.readEffects,
      repositoryRoot: root,
      runCommand: run,
    });
    if (options.sqlChecks.length > 0 || options.typesOutput)
      await applySupabaseCurrentTreeSources({
        apply,
        materializeSource: runtime.materializeSource,
        readSource: runtime.readSource,
        pendingSources: verified.manifest.pendingSources,
        postReplaySources: verified.postReplaySources,
        repositoryRoot: root,
        startingOrdinal: orderedSources.length + 1,
        workdir,
      });
    for (const [index, check] of options.sqlChecks.entries())
      await applySupabaseReplaySql(apply, {
        kind: 'sql-check',
        ordinal: index + 1,
        sqlPath: await runtime.repositoryPath(root, check),
      });
    if ((await version()) !== '170006')
      throw new Error('Local server version mismatch');
    if (options.typesOutput) {
      const generated = await generateSupabaseReplayTypes(run, databaseUrl);
      const output = await runtime.output(root, options.typesOutput);
      await output.replace(generated.stdout, { mode: 0o600 });
    }
    receipt = {
      baseSha: verified.manifest.baseSha,
      comparison: effects.comparison,
      effectSha256: effects.effectSha256,
      mode: options.mode,
      orderedSources,
      ...(productionOldCancellationProof
        ? { productionOldCancellationProof }
        : {}),
      serverVersionNum: 170006,
      sqlChecks: options.sqlChecks,
    };
    if (options.receiptOutput) {
      const output = await runtime.output(root, options.receiptOutput);
      await output.create(canonicalJsonValue(receipt), { mode: 0o600 });
    }
  } catch (error) {
    failure = error;
  }
  let cleanupFailed = false;
  let cleanupResult: ownershipTools.ReplayProjectCleanupResult | undefined;
  let canRemoveWorkdir = !cleanup;
  if (cleanup && ownership) {
    try {
      cleanupResult = await runtime.stopOwnedProject({
        expectedResources: expected,
        inspectResources: () => runtime.inspectResources(projectId, run),
        ownedTempRoot: path.dirname(workdir),
        ownership,
        runCommand: run,
      });
      canRemoveWorkdir = true;
    } catch {
      cleanupFailed = true;
    }
  } else if (cleanup) {
    cleanupFailed = true;
  }
  if (canRemoveWorkdir) {
    try {
      await runtime.removeWorkdir(workdir);
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) throw new Error('Supabase replay cleanup failed');
  if (failure) throw withCleanupDiagnostics(failure, cleanupResult);
  if (!receipt) throw new Error('Supabase replay did not produce a receipt');
  return receipt;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runSupabaseHistoryReplay(parseSupabaseReplayArguments(process.argv.slice(2)))
    .then((receipt) => process.stdout.write(canonicalJsonValue(receipt)))
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'Replay failed'}\n`
      );
      process.exitCode = 1;
    });
}
