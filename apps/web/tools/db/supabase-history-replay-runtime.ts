import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as portTools from './allocate-supabase-replay-ports';
import { executeSupabaseHistoryReplayVerification } from './execute-supabase-history-replay-verification';
import { materializeSupabaseHistoryReplay } from './materialize-supabase-history-replay';
import * as ownershipTools from './replay-project-ownership';
import { replayRepository } from './replay-repository-root';
import * as configTools from './rewrite-supabase-replay-config';
import { runProductionOldCancellationProof } from './run-production-old-cancellation-proof';
import { replayCommandRuntime } from './run-replay-command';
import {
  readReplayCommandExecutionTimeoutMs,
  verifySupabaseReplayContract,
} from './supabase-replay-contract';
import * as resourceTools from './supabase-replay-expected-resources';
import { verifySupabaseHistoryReplayManifest } from './verify-supabase-history-replay-manifest';
import { verifySupabaseReplayBootstrapHistory } from './verify-supabase-replay-bootstrap-history';

async function atomicReplace(target: string, bytes: string): Promise<void> {
  const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`;
  await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
  await fs.rename(temporary, target);
}

export function createSupabaseHistoryReplayRuntimeDependencies() {
  return {
    allocatePorts: portTools.allocateSupabaseReplayPorts,
    assertPortsAvailable: portTools.assertSupabaseReplayPortsAvailable,
    assertResources: resourceTools.assertSupabaseReplayResources,
    atomicReplace,
    copyBootstrapSource: replayRepository.copyBootstrapSource,
    createCommand: (root: string) =>
      replayCommandRuntime.create(root, {
        executionTimeoutMs: readReplayCommandExecutionTimeoutMs(),
      }),
    createOwnership: ownershipTools.createReplayProjectOwnership,
    expectedResources: resourceTools.expectedSupabaseReplayResources,
    inspectResources: resourceTools.inspectSupabaseReplayResources,
    makeWorkdir: () => fs.mkdtemp(path.join(tmpdir(), 'baci-supabase-replay-')),
    materializeReplay: materializeSupabaseHistoryReplay,
    materializeSource: replayRepository.materializeSource,
    output: replayRepository.output,
    parseConfig: configTools.parseSupabaseReplayConfig,
    readEffects: replayCommandRuntime.readBoundEffects as (
      options: Parameters<typeof replayCommandRuntime.readBoundEffects>[0]
    ) => Promise<unknown>,
    readSource: replayRepository.readSource,
    readText: (target: string) => fs.readFile(target, 'utf8'),
    removeWorkdir: (target: string) =>
      fs.rm(target, { force: true, recursive: true }),
    repositoryPath: replayRepository.source,
    rewriteConfig: configTools.rewriteSupabaseReplayConfig,
    stopOwnedProject: ownershipTools.stopOwnedReplayProject,
    verifyContract: verifySupabaseReplayContract,
    verifyBootstrapHistory: verifySupabaseReplayBootstrapHistory,
    verifyEffects: executeSupabaseHistoryReplayVerification,
    verifyManifest: verifySupabaseHistoryReplayManifest,
    verifyProductionOldCancellation: runProductionOldCancellationProof,
    writeOwnership: ownershipTools.writeReplayProjectOwnership,
  };
}

export type ReplayRuntimeDependencies = ReturnType<
  typeof createSupabaseHistoryReplayRuntimeDependencies
>;
