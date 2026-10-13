import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { config } from 'dotenv';
import { buildRemediationCodexCommand } from '../lib/remediation-codex-command.mjs';
import {
  assertCodexExecutionUsable,
  redactCodexError,
} from '../lib/remediation-codex-output.mjs';
import { buildRemediationEnvironments } from '../lib/remediation-environments.mjs';
import { runRemediationJobWithGlobalLock } from '../lib/remediation-global-lock.mjs';
import {
  buildRemediationReport,
  sendRemediationReportEmail,
} from '../lib/remediation-report.mjs';

const CANARY_PROMPT =
  'Run a non-mutating Codex canary. Inspect no files, make no changes, and return a short confirmation.';

function defaultRunner(command, args, options) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
}

function readPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function runRemediationCodexCanary({
  containerIdentity,
  env = process.env,
  logger = console,
  runner = defaultRunner,
} = {}) {
  if (env.BACI_REMEDIATION_CANARY_ENABLED !== '1') {
    return { skipped: true, type: 'canary_skipped' };
  }
  const repoDir = env.BACI_REPO_DIR;
  if (!repoDir) {
    throw new Error('BACI_REPO_DIR is required for the Codex canary');
  }
  for (const variable of [
    'BACI_CODEX_DOCKER_IMAGE',
    'BACI_CODEX_CONTAINER_BIN',
  ]) {
    if (!env[variable]) {
      throw new Error(`${variable} is required for the Codex canary`);
    }
  }

  const commandEnv = { ...process.env, ...env };
  const { child: childEnv } = buildRemediationEnvironments(commandEnv);
  const command = buildRemediationCodexCommand({
    codexBin: env.CODEX_BIN || 'codex',
    containerIdentity,
    env: commandEnv,
    enableSearch: false,
    prompt: CANARY_PROMPT,
    readOnly: true,
    repoDir,
    worktreeDir: repoDir,
  });

  try {
    const result = runner(command.command, command.args, {
      cwd: repoDir,
      env: childEnv,
      shell: false,
      timeout: readPositiveInt(env.BACI_CODEX_CANARY_TIMEOUT_MS, 60_000),
    });
    if (result.error) {
      throw redactCodexError(result.error);
    }
    assertCodexExecutionUsable(result);
    return { type: 'canary_completed' };
  } finally {
    if (command.cleanup) {
      try {
        const cleanup = runner(command.cleanup.command, command.cleanup.args, {
          cwd: repoDir,
          env: childEnv,
          shell: false,
        });
        if (cleanup?.error || cleanup?.status !== 0) {
          logger.error(JSON.stringify({ type: 'canary_cleanup_failed' }));
        }
      } catch {
        logger.error(JSON.stringify({ type: 'canary_cleanup_failed' }));
      }
    }
  }
}

export function failureType(error) {
  const message = String(error || '');
  if (
    /\b(?:quota_or_usage_limit|quota|usage limits?|rate limit)\b/i.test(message)
  ) {
    return 'canary_quota_failed';
  }
  if (
    /\b(?:authentication(?:[_\s-]?failure)?|not authenticated|unauthorized|login required)\b/i.test(
      message
    )
  ) {
    return 'canary_auth_failed';
  }
  return 'canary_toolchain_failed';
}

async function main() {
  try {
    console.log(JSON.stringify(runRemediationCodexCanary()));
  } catch (error) {
    try {
      await sendRemediationReportEmail({
        report: buildRemediationReport({
          actions: [{ type: failureType(error) }],
          mode: 'canary',
          policy: { allowed: false, reasons: ['canary execution failed'] },
          source: 'remediation-codex-canary',
        }),
      });
    } catch {
      // The JSONL status below remains the operator-visible fallback alert.
    }
    console.log(JSON.stringify({ type: failureType(error) }));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  config({ path: new URL('../.env', import.meta.url) });
  const exitCode = await runRemediationJobWithGlobalLock({
    main,
    scriptPath: process.argv[1],
    waitSeconds: 600,
  });
  if (exitCode !== null) process.exitCode = exitCode;
}
