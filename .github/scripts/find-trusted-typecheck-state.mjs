import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Artifacts are selected by immutable ID from successful main-push CI runs.
// Ordinary Actions caches search a PR's own namespace first, which is unsuitable
// for compiler diagnostic state supplied by an untrusted PR.
export function findTrustedTypecheckState({
  repository,
  repositoryId,
  artifactName,
  readApi,
}) {
  const id = Number(repositoryId);
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !artifactName
  )
    return null;
  try {
    const response = readApi(
      `repos/${repository}/actions/workflows/ci.yml/runs?event=push&branch=main&status=success&per_page=10`,
    );
    for (const run of response.workflow_runs ?? []) {
      if (
        run.event !== 'push' ||
        run.head_branch !== 'main' ||
        run.conclusion !== 'success' ||
        !['.github/workflows/ci.yml', '.github/workflows/ci.yml@main'].includes(
          run.path,
        ) ||
        run.repository?.id !== id ||
        !/^[a-f0-9]{40}$/.test(run.head_sha ?? '') ||
        !Number.isSafeInteger(run.id)
      )
        continue;
      const response = readApi(
        `repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`,
      );
      const artifact = response.artifacts?.find(
        (item) =>
          item.name === artifactName &&
          item.expired === false &&
          Number.isSafeInteger(item.id) &&
          item.workflow_run?.id === run.id &&
          item.workflow_run?.head_sha === run.head_sha &&
          item.workflow_run?.head_branch === 'main' &&
          item.workflow_run?.repository_id === id,
      );
      if (artifact) return { runId: run.id, artifactId: artifact.id };
    }
  } catch {
    // A cache miss or API failure must fall back to a cold, complete typecheck.
    return null;
  }
  return null;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = findTrustedTypecheckState({
    repository: process.env.GITHUB_REPOSITORY,
    repositoryId: process.env.GITHUB_REPOSITORY_ID,
    artifactName: process.env.TYPECHECK_ARTIFACT_NAME,
    readApi: (endpoint) =>
      JSON.parse(
        execFileSync('gh', ['api', endpoint], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 15_000,
        }),
      ),
  });
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `run-id=${result?.runId ?? ''}\nartifact-id=${result?.artifactId ?? ''}\n`,
  );
  console.log(
    result
      ? 'Restoring compiler state from successful main CI.'
      : 'No trusted compiler state available; typechecking cold.',
  );
}
