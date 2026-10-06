import { materializeSupabaseHistoryReplay } from '../../apps/web/tools/db/materialize-supabase-history-replay';
import { runSupabaseHistoryReplay } from '../../apps/web/tools/db/run-supabase-history-replay';
import { verifySupabaseHistoryReplayManifest } from '../../apps/web/tools/db/verify-supabase-history-replay-manifest';

const dependencies = {
  verify: verifySupabaseHistoryReplayManifest,
  materialize: materializeSupabaseHistoryReplay,
  run: runSupabaseHistoryReplay,
};

export async function hostedSavingsBootstrap(
  args: readonly string[],
  repositoryRoot: string,
  runtime: typeof dependencies = dependencies
) {
  if (
    args.length !== 1 ||
    !['--plan', '--fresh-disposable-local'].includes(args[0] ?? '')
  ) {
    throw new Error(
      'Use --plan or --fresh-disposable-local; destinations and resume are forbidden'
    );
  }
  const verified = await runtime.verify(repositoryRoot, {
    pendingRepairState: 'materialized',
  });
  const sources = runtime.materialize(verified, 'chronological');
  if (
    verified.bootstrapSources.length !== 125 ||
    sources.length < 125 ||
    verified.bootstrapSources.some(
      (source, index) =>
        source.repositoryPath !== sources[index]?.repositoryPath ||
        source.sha256 !== sources[index]?.sha256
    )
  ) {
    throw new Error('Fresh bootstrap prefix mismatch');
  }
  const plan = {
    destination: 'new-owned-disposable-local-database',
    bootstrapCount: verified.bootstrapSources.length,
    historicalCountIncludingBootstrap: sources.length,
    postReplayCount: verified.postReplaySources.length,
    pendingCount: verified.manifest.pendingSources.length,
    firstSource: sources[0]?.repositoryPath,
    resumeSupported: false,
  };
  if (args[0] === '--plan') return plan;
  await runtime.run({
    repositoryRoot,
    mode: 'chronological',
    pendingRepairState: 'materialized',
    comparisonMode: 'classify',
    productionOldCancellationProof: 'skip',
    sqlChecks: ['tools/test/piggyvest-full-schema-check.sql'],
  });
  return { ...plan, replayCompleted: true };
}
