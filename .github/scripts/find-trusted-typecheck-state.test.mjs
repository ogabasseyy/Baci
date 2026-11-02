import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

const moduleUrl = new URL(
  './find-trusted-typecheck-state.mjs',
  import.meta.url,
);
const sha = 'a'.repeat(40);
const run = {
  id: 10,
  event: 'push',
  head_branch: 'main',
  conclusion: 'success',
  path: '.github/workflows/ci.yml',
  head_sha: sha,
  repository: { id: 123 },
};
const artifact = {
  id: 20,
  name: 'compiler-state-key',
  expired: false,
  workflow_run: {
    id: 10,
    head_sha: sha,
    head_branch: 'main',
    repository_id: 123,
  },
};

for (const scenario of [
  'trusted',
  'main ref suffix',
  'other ref suffix',
  'pull request',
  'other branch',
  'failed CI',
  'other workflow',
  'other repository',
  'expired artifact',
  'wrong artifact key',
  'wrong artifact commit',
  'wrong artifact repository',
  'missing artifact provenance',
  'cache miss',
  'API failure',
]) {
  test(`compiler state provenance: ${scenario}`, async () => {
    assert.ok(existsSync(moduleUrl), 'missing trusted-state resolver');
    const { findTrustedTypecheckState } = await import(moduleUrl.href);
    const candidate = structuredClone(run);
    const saved = structuredClone(artifact);
    if (scenario === 'main ref suffix')
      candidate.path = '.github/workflows/ci.yml@main';
    if (scenario === 'other ref suffix')
      candidate.path = '.github/workflows/ci.yml@feature';
    if (scenario === 'pull request') candidate.event = 'pull_request';
    if (scenario === 'other branch') candidate.head_branch = 'feature';
    if (scenario === 'failed CI') candidate.conclusion = 'failure';
    if (scenario === 'other workflow')
      candidate.path = '.github/workflows/untrusted.yml';
    if (scenario === 'other repository') candidate.repository.id = 456;
    if (scenario === 'expired artifact') saved.expired = true;
    if (scenario === 'wrong artifact key') saved.name = 'other-key';
    if (scenario === 'wrong artifact commit')
      saved.workflow_run.head_sha = 'b'.repeat(40);
    if (scenario === 'wrong artifact repository')
      saved.workflow_run.repository_id = 456;
    if (scenario === 'missing artifact provenance') delete saved.workflow_run;
    const result = findTrustedTypecheckState({
      repository: 'example/Baci',
      repositoryId: '123',
      artifactName: artifact.name,
      readApi: (path) => {
        if (scenario === 'API failure') throw new Error('unavailable');
        if (path.includes('/workflows/ci.yml/runs?')) {
          assert.match(path, /event=push/);
          assert.match(path, /branch=main/);
          assert.match(path, /status=success/);
          return {
            workflow_runs: scenario === 'cache miss' ? [] : [candidate],
          };
        }
        assert.match(path, /\/runs\/10\/artifacts\?/);
        return { artifacts: [saved] };
      },
    });
    assert.deepEqual(
      result,
      ['trusted', 'main ref suffix'].includes(scenario)
        ? { runId: 10, artifactId: 20 }
        : null,
    );
  });
}
