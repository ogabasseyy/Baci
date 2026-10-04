import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Builds an isolated PATH with fake `vercel`/`pnpm`/`npx` shims whose deploy
// behaviour is selected by `mode`. Returns the temp dir plus the marker files
// the script writes to (attempts made, and the URL that was promoted).
export function makeFakeCommand(mode) {
  const tempDir = mkdtempSync(join(tmpdir(), 'baci-deploy-retry-'));
  const binDir = join(tempDir, 'bin');
  const attemptsFile = join(tempDir, 'attempts');
  const promotedFile = join(tempDir, 'promoted');
  const promoteCountFile = join(tempDir, 'promote-count');
  mkdirSync(binDir, { recursive: true });

  const fakeVercelPath = join(binDir, 'fake-vercel');
  const vercelPath = join(binDir, 'vercel');
  const rollbackFile = join(tempDir, 'rollback');
  const rollbackCountFile = join(tempDir, 'rollback-count');

  writeFileSync(
    fakeVercelPath,
    `#!/usr/bin/env bash
set -euo pipefail
command="\${1:-}"
if [ "$command" = "rollback" ]; then
  rcount=0
  if [ -f "${rollbackCountFile}" ]; then rcount="$(cat "${rollbackCountFile}")"; fi
  rcount=$((rcount + 1))
  echo "$rcount" > "${rollbackCountFile}"
  case "${mode}" in
    *rollback-fails*)
      echo "rollback failed for \${2:-}" >&2
      exit 1
      ;;
  esac
  echo "\${2:-}" > "${rollbackFile}"
  echo "rolled back to \${2:-}"
  exit 0
fi
if [ "$command" = "promote" ]; then
  case "${mode}" in
    *promote-flaky*)
      pcount=0
      if [ -f "${promoteCountFile}" ]; then pcount="$(cat "${promoteCountFile}")"; fi
      pcount=$((pcount + 1))
      echo "$pcount" > "${promoteCountFile}"
      if [ "$pcount" -eq 1 ]; then
        echo "transient promote failure" >&2
        exit 1
      fi
      ;;
    *promote-fails*)
      echo "promote failed for \${2:-}" >&2
      exit 1
      ;;
  esac
  echo "\${2:-}" > "${promotedFile}"
  echo "promoted \${2:-}"
  exit 0
fi
attempt=0
if [ -f "${attemptsFile}" ]; then
  attempt="$(cat "${attemptsFile}")"
fi
attempt=$((attempt + 1))
echo "$attempt" > "${attemptsFile}"
case "${mode}" in
  success)
    echo "Production: https://baci-success.vercel.app"
    echo "fake deploy ok"
    exit 0
    ;;
  success-without-target)
    echo "fake deploy ok"
    exit 0
    ;;
  retry-success)
    if [ "$attempt" -eq 1 ]; then
      echo "temporary network failure" >&2
      exit 1
    fi
    echo "Production: https://baci-retry.vercel.app"
    echo "fake deploy ok after retry"
    exit 0
    ;;
  retry-success-stale-target)
    if [ "$attempt" -eq 1 ]; then
      echo "Production: https://baci-stale.vercel.app"
      echo "temporary network failure" >&2
      exit 1
    fi
    echo "fake deploy ok after retry"
    exit 0
    ;;
  duplicate-id)
    echo "Error: custom deployment id already exists for this project" >&2
    exit 1
    ;;
  duplicate-id-after-created)
    if [ "$attempt" -eq 1 ]; then
      echo "Production: https://baci-recovered.vercel.app"
      echo "network failed after deployment creation" >&2
      exit 1
    fi
    echo "Error: custom deployment id already exists for this project" >&2
    exit 1
    ;;
  killed-137-after-create)
    # Same, but exit 137 -- as timeout does when it escalates from TERM to
    # SIGKILL against a hung, TERM-resistant deploy.
    echo "Production: https://baci-hang.vercel.app"
    exit 137
    ;;
  killed-137-promote-fails)
    # Killed (137) with a URL, but promotion fails (see the promote branch) --
    # models an unrelated/OOM kill whose deployment is not promotable, which must
    # retry instead of being treated as a recovered timeout.
    echo "Production: https://baci-hang.vercel.app"
    exit 137
    ;;
  killed-137-promote-flaky)
    # Killed (137) with a URL; the first promote fails transiently and the second
    # succeeds (see the promote branch), so the SAME target is re-promoted rather
    # than a new deploy being started.
    echo "Production: https://baci-hang.vercel.app"
    exit 137
    ;;
  success-rollback-fails)
    # Succeeds and stages like success, but every rollback fails (see
    # the rollback branch): the overlap recovery must fail loud with
    # a manual-reconcile directive after exhausting its retries.
    echo "Production: https://baci-success.vercel.app"
    echo "fake deploy ok"
    exit 0
    ;;
  success-promote-fails)
    # Succeeds and stages like success, but every promote fails (see
    # the promote branch): models the ambiguous failure where the
    # candidate may still be serving (the alias stub decides).
    echo "Production: https://baci-success.vercel.app"
    echo "fake deploy ok"
    exit 0
    ;;
  hang-until-killed)
    # A genuinely hanging deploy that only run_with_timeout's real timeout can
    # stop -- the actual CLI-57 failure. The URL is emitted from a subshell whose
    # exit flushes the pipe (so it survives in the log), then exec sleep makes the
    # sleep THIS process (no orphaned child) so the timeout's signal terminates it
    # cleanly.
    ( echo "Production: https://baci-hang.vercel.app" )
    exec sleep 3600
    ;;
  fatal)
    echo "fatal deploy failure" >&2
    exit 1
    ;;
esac
`,
    { mode: 0o755 }
  );

  writeFileSync(
    vercelPath,
    `#!/usr/bin/env bash
exec "${fakeVercelPath}" "$@"
`,
    { mode: 0o755 }
  );

  writeFileSync(
    join(binDir, 'pnpm'),
    `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = "exec" ]; then
  shift
fi
exec "$@"
`,
    { mode: 0o755 }
  );

  writeFileSync(
    join(binDir, 'npx'),
    `#!/usr/bin/env bash
set -euo pipefail
exec "$@"
`,
    { mode: 0o755 }
  );

  return {
    attemptsFile,
    binDir,
    promotedFile,
    rollbackCountFile,
    rollbackFile,
    tempDir,
  };
}

export function writeCountingOverlapCheck(tempDir, behavior) {
  const checkPath = `${tempDir}/overlap-check`;
  const callsPath = `${tempDir}/overlap-calls`;
  writeFileSync(
    checkPath,
    `#!/usr/bin/env bash
set -euo pipefail
calls=0
if [ -f "${callsPath}" ]; then calls="$(cat "${callsPath}")"; fi
printf '%s\\n' "$((calls + 1))" >"${callsPath}"
${behavior}
`,
    { mode: 0o755 }
  );
  return { checkPath, callsPath };
}

// Fake curl answering the previous-production capture: writes
// CURL_BODY to the -o file and prints CURL_CODE (no trailing
// newline, like curl -w). CURL_EXIT nonzero fails without output.
// CURL_BODY_<n> / CURL_CODE_<n> override the body / status for the
// nth call (1-based), for tests where the alias resolves
// differently across captures or fails transiently.
export function writeFakeCurl(binDir, tempDir) {
  const callsPath = `${tempDir}/curl-calls`;
  writeFileSync(
    `${binDir}/curl`,
    `#!/usr/bin/env bash
calls=0
if [ -f "${callsPath}" ]; then calls="$(cat "${callsPath}")"; fi
printf '%s\\n' "$((calls + 1))" >"${callsPath}"
if [ "\${CURL_EXIT:-0}" != "0" ]; then exit "$CURL_EXIT"; fi
out=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-o" ]; then out="$arg"; fi
  prev="$arg"
done
per_call="CURL_BODY_$((calls + 1))"
per_code="CURL_CODE_$((calls + 1))"
printf '%s' "\${!per_call:-\${CURL_BODY:-}}" > "$out"
printf '%s' "\${!per_code:-\${CURL_CODE:-200}}"
`,
    { mode: 0o755 }
  );
  return callsPath;
}

export const vercelEnv = {
  VERCEL_TOKEN: 'test-token',
  VERCEL_PROJECT_ID: 'prj_test',
  VERCEL_ORG_ID: 'team_test',
  OVERLAP_PRODUCTION_ALIAS: 'ogabassey.com',
};

// Alias-resolution response shape (`GET /v4/aliases/{alias}`): the
// REQUIRED deploymentId is the deployment serving production.
export const prevProdEnv = {
  ...vercelEnv,
  CURL_BODY:
    '{"alias":"ogabassey.com","deploymentId":"dpl_previous123","deployment":{"id":"dpl_previous123","url":"baci-previous.vercel.app"},"projectId":"prj_test"}',
  CURL_CODE: '200',
};
