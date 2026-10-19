import { createHash } from 'node:crypto';
import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { applySupabaseCurrentTreeSources } from '../../apps/web/tools/db/apply-supabase-current-tree-sources';
import { materializeSupabaseHistoryReplay } from '../../apps/web/tools/db/materialize-supabase-history-replay';
import { replayRepository } from '../../apps/web/tools/db/replay-repository-root';
import type { ReplaySource } from '../../apps/web/tools/db/supabase-history-replay-types';
import { verifySupabaseHistoryReplayManifest } from '../../apps/web/tools/db/verify-supabase-history-replay-manifest';
import { auditHostedSavingsSql } from './hosted-savings-materialize-audit';

const dependencies = {
  verify: verifySupabaseHistoryReplayManifest,
  order: materializeSupabaseHistoryReplay,
};
const digest = (bytes: string | Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

export async function materializeHostedSavings(
  args: readonly string[],
  repositoryRoot: string,
  runtime: typeof dependencies = dependencies
) {
  if (args.length !== 1 || args[0] !== '--materialize-only')
    throw new Error(
      'Only --materialize-only is allowed; destination, resume and execution are forbidden'
    );
  const root = await realpath(repositoryRoot);
  const verified = await runtime.verify(root, {
    pendingRepairState: 'materialized',
  });
  const ordered = runtime.order(verified, 'chronological');
  if (
    !verified.bootstrapSources.length ||
    ordered.length < verified.bootstrapSources.length ||
    verified.bootstrapSources.some(
      (source, index) =>
        source.repositoryPath !== ordered[index]?.repositoryPath ||
        source.sha256 !== ordered[index]?.sha256
    )
  )
    throw new Error('Materialization bootstrap prefix mismatch');
  const directory = await mkdtemp('/tmp/hosted-savings-materialize-');
  await chmod(directory, 0o700);
  const entries: {
    ordinal: number;
    stage: string;
    source: string;
    sourceSha256: string;
    transform: ReplaySource['transform'] | null;
    file: string;
    sha256: string;
    bytes: number;
  }[] = [];
  const findings: {
    file: string;
    source: string;
    category: string;
    line: number;
  }[] = [];
  const written = new Map<
    string,
    { source: ReplaySource; ordinal: number; stage: string }
  >();
  try {
    const materialize = async (
      sourceRoot: string,
      workdir: string,
      source: ReplaySource,
      ordinal: number
    ) => {
      const sqlPath = await replayRepository.materializeSource(
        sourceRoot,
        workdir,
        source,
        ordinal
      );
      await chmod(sqlPath, 0o600);
      written.set(sqlPath, { source, ordinal, stage: 'current-tree' });
      return sqlPath;
    };
    const record = async (sqlPath: string) => {
      const metadata = written.get(sqlPath);
      if (!metadata || metadata.ordinal !== entries.length + 1)
        throw new Error('Materialization recording order mismatch');
      const bytes = await readFile(sqlPath);
      const expected =
        metadata.source.transform?.outputSha256 ?? metadata.source.sha256;
      if (digest(bytes) !== expected)
        throw new Error('Materialized source hash mismatch');
      const file = path.relative(directory, sqlPath);
      entries.push({
        ordinal: metadata.ordinal,
        stage: metadata.stage,
        source: metadata.source.repositoryPath,
        sourceSha256: metadata.source.sha256,
        transform: metadata.source.transform ?? null,
        file,
        sha256: digest(bytes),
        bytes: bytes.length,
      });
      findings.push(
        ...auditHostedSavingsSql(bytes.toString('utf8')).map((finding) => ({
          ...finding,
          file,
          source: metadata.source.repositoryPath,
        }))
      );
    };
    for (const [index, source] of ordered.entries()) {
      const sqlPath = await materialize(root, directory, source, index + 1);
      written.set(sqlPath, {
        source,
        ordinal: index + 1,
        stage:
          index < verified.bootstrapSources.length ? 'bootstrap' : 'historical',
      });
      await record(sqlPath);
    }
    await applySupabaseCurrentTreeSources({
      apply: record,
      materializeSource: materialize,
      readSource: replayRepository.readSource,
      pendingSources: verified.manifest.pendingSources,
      postReplaySources: verified.postReplaySources,
      repositoryRoot: root,
      startingOrdinal: ordered.length + 1,
      workdir: directory,
    });
    const inputs = [
      ...ordered,
      ...verified.postReplaySources,
      ...verified.manifest.pendingSources,
    ].map((source) => ({
      source: source.repositoryPath,
      sha256: source.sha256,
    }));
    const audit = `${JSON.stringify(
      {
        status: 'REQUIRES_PARENT_REVIEW',
        limitation:
          'Text scan includes comments and function bodies, misses dynamic SQL; not an execution safety proof.',
        findings,
      },
      null,
      2
    )}\n`;
    const manifest = `${JSON.stringify(
      {
        format: 1,
        mode: 'materialize-only',
        baseSha: verified.manifest.baseSha,
        ordering:
          'existing chronological materializer then existing current-tree replacement applier',
        bootstrapCount: verified.bootstrapSources.length,
        inputs,
        entries,
        auditSha256: digest(audit),
        executionAuthorized: false,
        resumeSupported: false,
      },
      null,
      2
    )}\n`;
    await writeFile(path.join(directory, 'audit.json'), audit, {
      flag: 'wx',
      mode: 0o600,
    });
    await writeFile(path.join(directory, 'manifest.json'), manifest, {
      flag: 'wx',
      mode: 0o600,
    });
    await writeFile(
      path.join(directory, 'SHA256SUMS'),
      `${digest(manifest)}  manifest.json\n${digest(audit)}  audit.json\n${entries.map((entry) => `${entry.sha256}  ${entry.file}`).join('\n')}\n`,
      { flag: 'wx', mode: 0o600 }
    );
    return {
      directory,
      manifestSha256: digest(manifest),
      files: entries.length,
      sqlBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
      findings: findings.length,
      executionAuthorized: false,
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
