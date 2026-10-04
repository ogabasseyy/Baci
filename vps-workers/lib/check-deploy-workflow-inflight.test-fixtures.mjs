import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const libPath = join(scriptDir, 'check-deploy-workflow-inflight.sh');
export const deployPath = join(scriptDir, '..', 'deploy.sh');
export const systemBash = existsSync('/bin/bash') ? '/bin/bash' : 'bash';

export function writeStub(binDir, name, body) {
  const path = join(binDir, name);
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

export function runCheck({
  ghBody,
  gitBody = 'if [ "$1 $2 $3" = "remote get-url origin" ]; then echo \'https://github.com/example-owner/example-repo.git\'; else exit 1; fi',
  env = {},
  path = null,
}) {
  const workDir = mkdtempSync(join(tmpdir(), 'baci-inflight-'));
  const binDir = join(workDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const argsFile = join(workDir, 'gh-args.txt');
  writeStub(binDir, 'gh', ghBody.replaceAll('__ARGS_FILE__', argsFile));
  if (gitBody !== null) {
    writeStub(binDir, 'git', gitBody);
  }
  const result = spawnSync(
    systemBash,
    [
      '-c',
      'set -euo pipefail; source "$CHECK_LIB"; check_deploy_workflow_inflight',
    ],
    {
      cwd: workDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        // Deterministic control env: a real BACI_DEPLOY_* export on the
        // dev machine must not flip these cases (per-test env wins).
        BACI_DEPLOY_SKIP_INFLIGHT_CHECK: '',
        BACI_DEPLOY_WORKFLOW_REPO: '',
        ...env,
        CHECK_LIB: libPath,
        GH_ARGS_FILE: argsFile,
        PATH: path ?? `${binDir}:${process.env.PATH}`,
      },
    }
  );
  return {
    result,
    ghArgs: existsSync(argsFile) ? readFileSync(argsFile, 'utf8').trim() : '',
  };
}

export const RECORD_ARGS = 'echo "$@" > "$GH_ARGS_FILE"';
