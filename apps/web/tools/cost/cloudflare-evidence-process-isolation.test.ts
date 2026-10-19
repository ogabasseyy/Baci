import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { calculateReviewedPolicySha256 } from './cloudflare-evidence-prepare';
import { spawnIsolatedCloudflareEvidenceProcess } from './cloudflare-evidence-process-isolation';
import {
  makePrivateTempDir,
  writeProtectedMergeIdentity,
} from './cloudflare-evidence-process-isolation.test-fixtures';
import { holdCloudflareEvidenceWorkspaceTestLock } from './cloudflare-evidence-process-isolation-workspace-lock.test-support';

const runnerModulePathFor = (workspaceRoot: string) =>
  resolve(
    workspaceRoot,
    'apps/web/tools/cost/cloudflare-evidence-authenticated-runner.test-fixture.ts'
  );

const workspaceRoot = resolve(import.meta.dirname, '../../../..');
let releaseWorkspaceLock: (() => Promise<void>) | undefined;

describe('spawnIsolatedCloudflareEvidenceProcess', () => {
  const runId = 'b'.repeat(32);
  const prepareInput = {
    runId,
    approvalId: 'approval-123',
    policyId: 'policy-123',
    toolingMergeSha: '1'.repeat(40),
    writeTokenId: 'write-token-id',
    readTokenId: 'read-token-id',
    readPolicySha256: 'c'.repeat(64),
    accountId: 'account-id',
    zoneId: 'zone-id',
    plannedResources: [`baci-evidence-${runId}`],
    preInventorySha256: 'a'.repeat(64),
    expectedProbeCount: 2,
  };
  beforeEach(async () => {
    releaseWorkspaceLock =
      await holdCloudflareEvidenceWorkspaceTestLock(workspaceRoot);
    // The credentialed isolation suite shares this cross-process lock and can
    // spend about a minute verifying its private dependency closures.
  }, 120_000);
  afterEach(async () => {
    try {
      await releaseWorkspaceLock?.();
    } finally {
      releaseWorkspaceLock = undefined;
    }
  });
  it('creates a private initial journal and prints only its bounded handoff', async () => {
    const { stdout: toolingMergeSha } = await promisify(execFile)('git', [
      '-C',
      workspaceRoot,
      'rev-parse',
      '--verify',
      'HEAD',
    ]);
    const reviewedPrepareInput = {
      ...prepareInput,
      toolingMergeSha: toolingMergeSha.trim(),
    };
    const runnerModulePath = runnerModulePathFor(workspaceRoot);
    const runnerModuleSha256 = createHash('sha256')
      .update(await readFile(runnerModulePath))
      .digest('hex');
    const authorityModulePath = resolve(
      import.meta.dirname,
      'cloudflare-evidence-process-isolation.test-fixtures.ts'
    );
    const authorityModuleSha256 = createHash('sha256')
      .update(await readFile(authorityModulePath))
      .digest('hex');
    const authorityDir = await makePrivateTempDir('baci-evidence-authority-');
    const authorityNow = new Date();
    const approvedAt = new Date(
      authorityNow.valueOf() - 60 * 1000
    ).toISOString();
    const expiresAt = new Date(
      authorityNow.valueOf() + 60 * 60 * 1000
    ).toISOString();
    const policy = {
      id: reviewedPrepareInput.policyId,
      toolingMergeSha: reviewedPrepareInput.toolingMergeSha,
      tokenId: reviewedPrepareInput.writeTokenId,
      accountId: reviewedPrepareInput.accountId,
      zoneId: reviewedPrepareInput.zoneId,
      permissionGroupIds: ['workers.write'],
      resources: ['account'],
      expiresAt,
      policySha256: calculateReviewedPolicySha256({
        tokenId: reviewedPrepareInput.writeTokenId,
        accountId: reviewedPrepareInput.accountId,
        zoneId: reviewedPrepareInput.zoneId,
        permissionGroupIds: ['workers.write'],
        resources: ['account'],
        expiresAt,
      }),
    };
    const authority = {
      id: reviewedPrepareInput.approvalId,
      toolingMergeSha: reviewedPrepareInput.toolingMergeSha,
      policyId: reviewedPrepareInput.policyId,
      policySha256: policy.policySha256,
      readTokenId: reviewedPrepareInput.readTokenId,
      readPolicySha256: reviewedPrepareInput.readPolicySha256,
      mutationRunnerModuleSha256: runnerModuleSha256,
      measurementRunnerModuleSha256: runnerModuleSha256,
      readRevocationRunnerModuleSha256: runnerModuleSha256,
      approvedAt,
      expiresAt,
    };
    const approvalPath = join(authorityDir, 'approval.json');
    const policyPath = join(authorityDir, 'policy.json');
    const protectedMergeIdentityPath = join(
      authorityDir,
      'protected-merge-identity.json'
    );
    await writeFile(approvalPath, JSON.stringify(authority), { mode: 0o600 });
    await writeFile(policyPath, JSON.stringify(policy), { mode: 0o600 });
    await writeProtectedMergeIdentity(
      protectedMergeIdentityPath,
      reviewedPrepareInput.toolingMergeSha
    );
    const stateDir = await makePrivateTempDir('baci-prepare-child-');
    let stdout = '';
    let stderr = '';
    const spawner = {
      spawn: async (
        executable: string,
        argv: readonly string[],
        options: { cwd: string; env: Record<string, string> }
      ) => {
        const result = await promisify(execFile)(
          executable,
          [...argv],
          options
        );
        stdout = result.stdout;
        stderr = result.stderr;
      },
    };
    await spawnIsolatedCloudflareEvidenceProcess(
      spawner,
      'prepare',
      reviewedPrepareInput.runId,
      {
        PATH: process.env.PATH ?? '',
        SECRET_THAT_MUST_NOT_ESCAPE: 'never-forward',
        CLOUDFLARE_WRITE_TOKEN: 'credential-must-not-escape',
        EVIDENCE_APPROVAL_ARTIFACT: approvalPath,
        EVIDENCE_POLICY_ARTIFACT: policyPath,
        EVIDENCE_PROTECTED_MERGE_IDENTITY_ARTIFACT: protectedMergeIdentityPath,
        EVIDENCE_PROTECTED_MERGE_AUTHORITY_MODULE: authorityModulePath,
        EVIDENCE_PROTECTED_MERGE_AUTHORITY_MODULE_SHA256: authorityModuleSha256,
        EVIDENCE_MUTATION_RUNNER_MODULE: runnerModulePath,
        EVIDENCE_MUTATION_RUNNER_MODULE_SHA256: runnerModuleSha256,
        EVIDENCE_MEASUREMENT_RUNNER_MODULE: runnerModulePath,
        EVIDENCE_MEASUREMENT_RUNNER_MODULE_SHA256: runnerModuleSha256,
        EVIDENCE_READ_TOKEN_REVOCATION_READBACK_MODULE: runnerModulePath,
        EVIDENCE_READ_TOKEN_REVOCATION_READBACK_MODULE_SHA256:
          runnerModuleSha256,
      },
      undefined,
      workspaceRoot,
      stateDir,
      reviewedPrepareInput
    );
    expect(stdout).toBe(
      `${JSON.stringify({ runId: reviewedPrepareInput.runId, nextPhase: 'mutate' })}\n`
    );
    const journalPath = join(stateDir, `${prepareInput.runId}.json`);
    const rawJournal = await readFile(journalPath, 'utf8');
    expect(JSON.parse(rawJournal)).toMatchObject({
      ...reviewedPrepareInput,
      policySha256: policy.policySha256,
      mutationRunnerModulePath: runnerModulePath,
      mutationRunnerModuleSha256: runnerModuleSha256,
      measurementRunnerModulePath: runnerModulePath,
      measurementRunnerModuleSha256: runnerModuleSha256,
      readRevocationRunnerModulePath: runnerModulePath,
      readRevocationRunnerModuleSha256: runnerModuleSha256,
      phase: 'prepared',
      cleanupAttempts: 0,
    });
    expect((await lstat(journalPath)).mode & 0o077).toBe(0);
    expect(`${stdout}${stderr}${rawJournal}`).not.toContain('never-forward');
    expect(`${stdout}${stderr}${rawJournal}`).not.toContain(
      'credential-must-not-escape'
    );
    await expect(
      spawnIsolatedCloudflareEvidenceProcess(
        spawner,
        'prepare',
        reviewedPrepareInput.runId,
        {
          PATH: process.env.PATH ?? '',
          EVIDENCE_APPROVAL_ARTIFACT: approvalPath,
          EVIDENCE_POLICY_ARTIFACT: policyPath,
          EVIDENCE_PROTECTED_MERGE_IDENTITY_ARTIFACT:
            protectedMergeIdentityPath,
          EVIDENCE_PROTECTED_MERGE_AUTHORITY_MODULE: authorityModulePath,
          EVIDENCE_PROTECTED_MERGE_AUTHORITY_MODULE_SHA256:
            authorityModuleSha256,
          EVIDENCE_MUTATION_RUNNER_MODULE: runnerModulePath,
          EVIDENCE_MUTATION_RUNNER_MODULE_SHA256: runnerModuleSha256,
          EVIDENCE_MEASUREMENT_RUNNER_MODULE: runnerModulePath,
          EVIDENCE_MEASUREMENT_RUNNER_MODULE_SHA256: runnerModuleSha256,
          EVIDENCE_READ_TOKEN_REVOCATION_READBACK_MODULE: runnerModulePath,
          EVIDENCE_READ_TOKEN_REVOCATION_READBACK_MODULE_SHA256:
            runnerModuleSha256,
        },
        undefined,
        workspaceRoot,
        stateDir,
        reviewedPrepareInput
      )
    ).rejects.toThrow('active');
  }, 120_000);
});
