import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnIsolatedCloudflareEvidenceProcess } from './cloudflare-evidence-process-isolation';
import {
  createEvidenceDependencyIntegrityAuthority,
  makePrivateTempDir,
  readEvidenceDependencyManifestSha256,
  readEvidenceToolingHead,
} from './cloudflare-evidence-process-isolation.test-fixtures';
import { holdCloudflareEvidenceWorkspaceTestLock } from './cloudflare-evidence-process-isolation-workspace-lock.test-support';
import { REVIEWED_EVIDENCE_SYSTEM_PATH } from './cloudflare-evidence-qualification-cli';
import { openEvidenceRun } from './cloudflare-evidence-run-journal';

type Spawn = (
  executable: string,
  argv: readonly string[],
  options: { cwd: string; env: Record<string, string> }
) => Promise<void>;

const runnerModulePathFor = (workspaceRoot: string) =>
  resolve(workspaceRoot, '.cloudflare-evidence-untracked-runner-fixture.ts');

const workspaceRoot = resolve(import.meta.dirname, '../../../..');
let untrackedRunnerPath: string | undefined;
let releaseWorkspaceLock: (() => Promise<void>) | undefined;

beforeEach(async () => {
  releaseWorkspaceLock =
    await holdCloudflareEvidenceWorkspaceTestLock(workspaceRoot);
  // This lock is shared with the non-credentialed integration suite, whose
  // integrity walk must be allowed to finish before this case starts.
}, 120_000);

afterEach(async () => {
  try {
    if (untrackedRunnerPath) await rm(untrackedRunnerPath, { force: true });
  } finally {
    untrackedRunnerPath = undefined;
    try {
      await releaseWorkspaceLock?.();
    } finally {
      releaseWorkspaceLock = undefined;
    }
  }
});

describe('spawnIsolatedCloudflareEvidenceProcess credential handoff', () => {
  it('uses separate children with one allowlisted credential and exact command ownership', async () => {
    const spawn = vi.fn<Spawn>(async () => undefined);
    const untrustedPath = resolve(import.meta.dirname, 'untrusted-bin');
    const inherited = {
      PATH: `${untrustedPath}${delimiter}${dirname(process.execPath)}`,
      SECRET: 'never-forward',
    };
    const stateDir = await makePrivateTempDir('baci-evidence-isolation-');
    const toolingMergeSha = await readEvidenceToolingHead(workspaceRoot);
    const runnerModulePath = runnerModulePathFor(workspaceRoot);
    untrackedRunnerPath = runnerModulePath;
    await writeFile(
      runnerModulePath,
      'export const authenticatedPostMergeAdapter = true;\n'
    );
    const runnerModuleSha256 = createHash('sha256')
      .update(await readFile(runnerModulePath))
      .digest('hex');
    const { manifestPath, protectedMergeIdentityPath } =
      await createEvidenceDependencyIntegrityAuthority(
        workspaceRoot,
        toolingMergeSha,
        ['zod', 'tsx', 'esbuild']
      );
    const dependencyManifestSha256 =
      await readEvidenceDependencyManifestSha256(manifestPath);
    const runId = 'b'.repeat(32);
    await openEvidenceRun(stateDir, {
      runId,
      approvalId: 'approval-123',
      policyId: 'policy-123',
      toolingMergeSha,
      writeTokenId: 'write-token-id',
      readTokenId: 'read-token-id',
      readPolicySha256: 'c'.repeat(64),
      accountId: 'account-id',
      zoneId: 'zone-id',
      plannedResources: [`baci-evidence-${runId}`],
      preInventorySha256: 'a'.repeat(64),
      expectedProbeCount: 2,
      mutationRunnerModulePath: runnerModulePath,
      mutationRunnerModuleSha256: runnerModuleSha256,
      measurementRunnerModulePath: runnerModulePath,
      measurementRunnerModuleSha256: runnerModuleSha256,
      dependencyManifestSha256,
    });
    const attackerPath = '/tmp/attacker-runner.ts';
    const credentialInherited = {
      ...inherited,
      EVIDENCE_DEPENDENCY_INTEGRITY_MANIFEST: manifestPath,
      EVIDENCE_PROTECTED_MERGE_IDENTITY_ARTIFACT: protectedMergeIdentityPath,
      EVIDENCE_MUTATION_RUNNER_MODULE: attackerPath,
      EVIDENCE_MUTATION_RUNNER_MODULE_SHA256: 'f'.repeat(64),
      EVIDENCE_MEASUREMENT_RUNNER_MODULE: attackerPath,
      EVIDENCE_MEASUREMENT_RUNNER_MODULE_SHA256: 'f'.repeat(64),
    };
    await spawnIsolatedCloudflareEvidenceProcess(
      { spawn },
      'mutate',
      runId,
      credentialInherited,
      { name: 'CLOUDFLARE_WRITE_TOKEN', value: 'write' },
      workspaceRoot,
      stateDir
    );
    await spawnIsolatedCloudflareEvidenceProcess(
      { spawn },
      'cleanup',
      runId,
      credentialInherited,
      { name: 'CLOUDFLARE_WRITE_TOKEN', value: 'write' },
      workspaceRoot,
      stateDir
    );
    await spawnIsolatedCloudflareEvidenceProcess(
      { spawn },
      'measure',
      runId,
      credentialInherited,
      { name: 'CLOUDFLARE_READ_TOKEN', value: 'read' },
      workspaceRoot,
      stateDir
    );
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(spawn.mock.calls[0]?.[1].slice(2)).toEqual([
      '--run',
      runId,
      '--apply',
    ]);
    expect(spawn.mock.calls[1]?.[1].slice(2)).toEqual(['--cleanup-run', runId]);
    expect(spawn.mock.calls[2]?.[1].slice(2)).toEqual(['--run', runId]);
    for (const [executable, argv, options] of spawn.mock.calls) {
      expect(executable).toBe(process.execPath);
      expect(argv[0]).toContain('baci-evidence-closure-');
      expect(argv[1]).toContain('baci-evidence-closure-');
      expect(options.cwd).toContain('baci-evidence-closure-');
      expect(options.env.EVIDENCE_EXECUTION_ROOT).toContain(
        'baci-evidence-closure-'
      );
      expect(options.env.EVIDENCE_RUN_STATE_DIR).toBe(stateDir);
      expect(options.env.EVIDENCE_DEPENDENCY_INTEGRITY_MANIFEST).toContain(
        'baci-evidence-closure-'
      );
    }
    for (const [, , { env }] of spawn.mock.calls.slice(0, 2)) {
      expect(env.PATH).toBe(REVIEWED_EVIDENCE_SYSTEM_PATH);
      expect(env.SECRET).toBeUndefined();
      expect(env.EVIDENCE_DEPENDENCY_INTEGRITY_MANIFEST).toContain(
        'baci-evidence-closure-'
      );
      expect(env.EVIDENCE_MUTATION_RUNNER_MODULE).toContain(
        'baci-evidence-closure-'
      );
      expect(env.EVIDENCE_MUTATION_RUNNER_MODULE_SHA256).toBe(
        runnerModuleSha256
      );
      expect(
        Object.keys(env).filter((key) => key.includes('TOKEN'))
      ).toHaveLength(
        env.CLOUDFLARE_WRITE_TOKEN || env.CLOUDFLARE_READ_TOKEN ? 1 : 0
      );
    }
    const measureEnvironment = spawn.mock.calls[2]?.[2].env;
    expect(measureEnvironment.PATH).toBe(REVIEWED_EVIDENCE_SYSTEM_PATH);
    expect(measureEnvironment.EVIDENCE_MEASUREMENT_RUNNER_MODULE).toContain(
      'baci-evidence-closure-'
    );
    expect(measureEnvironment.EVIDENCE_MEASUREMENT_RUNNER_MODULE_SHA256).toBe(
      runnerModuleSha256
    );
    expect(measureEnvironment.EVIDENCE_MUTATION_RUNNER_MODULE).toBeUndefined();

    const journalPath = join(stateDir, `${runId}.json`);
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const { dependencyManifestSha256: _ignored, ...withoutDigest } = journal;
    await writeFile(journalPath, JSON.stringify(withoutDigest), {
      mode: 0o600,
    });
    await expect(
      spawnIsolatedCloudflareEvidenceProcess(
        { spawn },
        'mutate',
        runId,
        credentialInherited,
        { name: 'CLOUDFLARE_WRITE_TOKEN', value: 'write' },
        workspaceRoot,
        stateDir
      )
    ).rejects.toThrow('authenticated dependency integrity manifest hash');
    expect(spawn).toHaveBeenCalledTimes(3);

    await writeFile(
      journalPath,
      JSON.stringify({
        ...journal,
        dependencyManifestSha256: 'f'.repeat(64),
      }),
      { mode: 0o600 }
    );
    await expect(
      spawnIsolatedCloudflareEvidenceProcess(
        { spawn },
        'mutate',
        runId,
        credentialInherited,
        { name: 'CLOUDFLARE_WRITE_TOKEN', value: 'write' },
        workspaceRoot,
        stateDir
      )
    ).rejects.toThrow('does not match the reviewed authority');
    expect(spawn).toHaveBeenCalledTimes(3);
    // This integration case verifies and materializes three independent private
    // dependency closures. Keep a finite timeout, but allow the cryptographic
    // integrity walk to complete on slower CI and disk-constrained runners.
  }, 120_000);
});
