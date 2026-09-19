import type { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { buildSupabaseHistoryEffectDigests } from './build-supabase-history-effect-digests';
import { createProductionOldCancellationProofSession } from './production-old-cancellation-proof-session';
import { replayRepository } from './replay-repository-root';
import { productionOldCancellationProofSchema } from './schemas/production-old-cancellation-proof-schema';
import { supabaseHistoryEffectSnapshotSchema } from './schemas/supabase-history-effect-snapshot-schema';
import { supabaseHistoryEffectQueryContract } from './supabase-history-effect-query-contract';
import type { ProductionOldCancellationProofReceipt } from './supabase-history-replay-types';
import { validateSupabaseHistoryEffectComponents } from './validate-supabase-history-effect-components';

const EVIDENCE_PATH =
  'apps/web/tools/db/fixtures/production-old-cancellation-proof.json';
const EFFECT_QUERY_PATH = 'apps/web/tools/db/supabase-history-effects.sql';
const OLD_ASSERTION_PATH =
  'supabase/tests/migration_history_overlays/assert_production_old_cancel_order_as_customer.sql';
const REPAIRED_ASSERTION_PATH =
  'supabase/tests/migration_history_overlays/assert_repaired_cancel_order_as_customer.sql';
const REPAIR_PATH =
  'supabase/migrations/20260714225503_reconcile_customer_order_cancellation_reason.sql';
const CANCELLATION_IDENTITY =
  'public.cancel_order_as_customer(p_order_id uuid, p_reason text)';

type ProofOptions = {
  databaseUrl: string;
  environment: Partial<NodeJS.ProcessEnv>;
  psqlBin: string;
  repositoryRoot: string;
};

type ProofSession = ReturnType<
  typeof createProductionOldCancellationProofSession
>;

type ProofDependencies = {
  createMarker?: () => string;
  createSession?: (options: {
    environment: Partial<NodeJS.ProcessEnv>;
    psqlBin: string;
    spawnProcess?: typeof spawn;
  }) => ProofSession;
  readCancellationDigest?: (snapshot: string) => string;
  readSource?: (root: string, repositoryPath: string) => Promise<string>;
  resolveSource?: (root: string, repositoryPath: string) => Promise<string>;
};

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

function proofError(reason: string): Error {
  return new Error(`Production-old cancellation proof failed: ${reason}`);
}

function defaultMarker(): string {
  return `__BACI_PROOF_${randomBytes(12).toString('hex').toUpperCase()}__`;
}

function includeSource(sourcePath: string): string {
  if (!/^\/[A-Za-z0-9._/-]+$/.test(sourcePath)) {
    throw proofError('unsafe-source');
  }
  return `\\ir ${sourcePath}`;
}

function snapshotBetween(output: string, beginMarker: string): string {
  const lines = output.split('\n');
  const indexes = lines.flatMap((line, index) =>
    line === beginMarker ? [index] : []
  );
  if (indexes.length !== 1) throw proofError('invalid-snapshot');
  const snapshotLines = lines
    .slice((indexes[0] as number) + 1)
    .filter((line) => line.length > 0);
  if (snapshotLines.length !== 1) throw proofError('invalid-snapshot');
  return snapshotLines[0] as string;
}

function cancellationDigest(snapshotText: string): string {
  let raw: unknown;
  try {
    raw = JSON.parse(snapshotText);
  } catch {
    throw proofError('invalid-snapshot');
  }
  const snapshot = supabaseHistoryEffectSnapshotSchema.parse(raw);
  validateSupabaseHistoryEffectComponents(snapshot.components);
  const { digestVector } = buildSupabaseHistoryEffectDigests(
    snapshot.components
  );
  const cancellation = digestVector.filter(
    ({ category, identity }) =>
      category === 'function' && identity === CANCELLATION_IDENTITY
  );
  if (cancellation.length !== 1) throw proofError('invalid-snapshot');
  return (cancellation[0] as { sha256: string }).sha256;
}

export async function runProductionOldCancellationProof(
  options: ProofOptions,
  dependencies: ProofDependencies = {}
): Promise<ProductionOldCancellationProofReceipt> {
  const readSource =
    dependencies.readSource ??
    (async (root: string, repositoryPath: string) =>
      (await replayRepository.readSource(root, repositoryPath)).toString(
        'utf8'
      ));
  const resolveSource = dependencies.resolveSource ?? replayRepository.source;
  const createMarker = dependencies.createMarker ?? defaultMarker;
  const readCancellationDigest =
    dependencies.readCancellationDigest ?? cancellationDigest;
  let session: ProofSession | undefined;
  let closed = false;
  try {
    const evidence = productionOldCancellationProofSchema.parse(
      JSON.parse(await readSource(options.repositoryRoot, EVIDENCE_PATH))
    );
    const [effectQuery, overlay] = await Promise.all([
      readSource(options.repositoryRoot, EFFECT_QUERY_PATH),
      readSource(options.repositoryRoot, evidence.overlay.path),
    ]);
    const definition = `${overlay.split('\n;\n', 1)[0]}\n`;
    if (
      sha256(effectQuery) !== supabaseHistoryEffectQueryContract.querySha256 ||
      sha256(overlay) !== evidence.overlay.sha256 ||
      Buffer.byteLength(definition) !== evidence.definition.byteCount ||
      sha256(definition) !== evidence.definition.sha256
    ) {
      throw proofError('evidence-drift');
    }
    const overlayPath = await resolveSource(
      options.repositoryRoot,
      evidence.overlay.path
    );
    session = (
      dependencies.createSession ?? createProductionOldCancellationProofSession
    )({
      environment: options.environment,
      psqlBin: options.psqlBin,
    });
    const oldBegin = createMarker();
    const oldEnd = createMarker();
    const oldOutput = await session.exchange(
      [
        'BEGIN;',
        includeSource(overlayPath),
        `\\echo ${oldBegin}`,
        effectQuery,
      ].join('\n'),
      oldEnd
    );
    const productionSha256 = readCancellationDigest(
      snapshotBetween(oldOutput, oldBegin)
    );
    if (productionSha256 !== evidence.componentSha256) {
      throw proofError('old-digest-mismatch');
    }
    const oldAssertionPath = await resolveSource(
      options.repositoryRoot,
      OLD_ASSERTION_PATH
    );
    const oldProbeBegin = createMarker();
    const oldProbeEnd = createMarker();
    await session.exchange(
      [
        'SAVEPOINT baci_production_old_probe;',
        includeSource(oldAssertionPath),
        'ROLLBACK TO SAVEPOINT baci_production_old_probe;',
        'RELEASE SAVEPOINT baci_production_old_probe;',
        `\\echo ${oldProbeBegin}`,
      ].join('\n'),
      oldProbeEnd
    );
    let repairPath: string;
    try {
      repairPath = await resolveSource(options.repositoryRoot, REPAIR_PATH);
    } catch {
      throw proofError('repair-not-materialized');
    }
    const repairedAssertionPath = await resolveSource(
      options.repositoryRoot,
      REPAIRED_ASSERTION_PATH
    );
    const repairedBegin = createMarker();
    const repairedEnd = createMarker();
    const repairedOutput = await session.exchange(
      [
        includeSource(repairPath),
        'SAVEPOINT baci_repaired_probe;',
        includeSource(repairedAssertionPath),
        'ROLLBACK TO SAVEPOINT baci_repaired_probe;',
        'RELEASE SAVEPOINT baci_repaired_probe;',
        `\\echo ${repairedBegin}`,
        effectQuery,
      ].join('\n'),
      repairedEnd
    );
    const repairedSha256 = readCancellationDigest(
      snapshotBetween(repairedOutput, repairedBegin)
    );
    if (repairedSha256 === productionSha256) {
      throw proofError('repaired-digest-mismatch');
    }
    await session.rollbackAndClose();
    closed = true;
    return { productionSha256, repairedSha256, verified: true };
  } catch (error) {
    if (session && !closed) {
      await session.rollbackAndClose().catch(() => undefined);
    }
    if (
      error instanceof Error &&
      /^Production-old cancellation proof failed: [a-z-]+$/.test(error.message)
    ) {
      throw error;
    }
    throw proofError('verification-failed');
  }
}
